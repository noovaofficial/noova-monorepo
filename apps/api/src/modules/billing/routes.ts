import {
  activateListingInputSchema,
  activateListingResultSchema,
  adjustBalanceInputSchema,
  adjustBalanceResultSchema,
  billingConfigInputSchema,
  billingOperationsSchema,
  buyTopInputSchema,
  buyTopResultSchema,
  createTopupInputSchema,
  createTopupResultSchema,
  currentListingSchema,
  priceBookSchema,
  toPriceBook,
  topStateSchema,
  topupOrderSchema,
  walletSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../env.js';
import { BILLING_TAG, PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { loadBillingConfig, saveBillingConfig } from './config.js';
import { activateListing } from './listing.js';
import {
  isPaymentoConfigured,
  isValidSignature,
  PaymentoError,
  parseCallback,
} from './paymento.js';
import { buyTop, TopFullError, TopNotPublishedError, topState } from './top.js';
import {
  createTopupOrder,
  settleCallback,
  TopupTierNotFoundError,
  toTopupOrder,
} from './topups.js';
import {
  applyTransaction,
  InsufficientBalanceError,
  toListing,
  toTransaction,
  WalletOwnerNotFoundError,
} from './wallet.js';

/**
 * Прайс монетизации (payments.md §8, этап 1).
 *
 * Публичный маршрут отдаёт то же, что и админский: в прайсе нет ничего
 * секретного — витрина показывает цены, кабинет показывает лестницу. Разница
 * только в праве записи.
 */
export const billingRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const guard = fastify.requireRole('admin');

  fastify.get(
    '/billing/price-book',
    {
      schema: {
        tags: ['billing'],
        response: { 200: priceBookSchema },
      },
    },
    async () => toPriceBook(await loadBillingConfig(fastify.prisma)),
  );

  fastify.get(
    '/admin/billing/config',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        response: { 200: priceBookSchema },
      },
    },
    async () => toPriceBook(await loadBillingConfig(fastify.prisma)),
  );

  fastify.put(
    '/admin/billing/config',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        body: billingConfigInputSchema,
        response: { 200: priceBookSchema },
      },
    },
    async (request) => {
      const saved = await saveBillingConfig(fastify.prisma, request.body);
      // Витрина кэшируется: без сброса новая цена доехала бы до посетителя
      // с опозданием, и админ решил бы, что сохранение не сработало.
      fastify.revalidate([BILLING_TAG]);
      return toPriceBook(saved);
    },
  );

  // --- Кошелёк (этап 2) ---------------------------------------------------

  fastify.get(
    '/billing/wallet',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['billing'],
        response: { 200: walletSchema },
      },
    },
    async (request) => {
      const { userId, role } = requireSession(request);
      // Кошелёк есть только у того, кто размещается: клиенту каталога тратить
      // GlowCoin негде, и пустой кошелёк был бы обещанием покупки без смысла.
      if (role !== 'advertiser') {
        throw fastify.httpErrors.forbidden('Кошелёк есть только у рекламодателя');
      }

      const [user, rows] = await Promise.all([
        fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { glowcoinBalance: true },
        }),
        fastify.prisma.billingTransaction.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);
      if (!user) throw fastify.httpErrors.notFound('Пользователь не найден');

      return { balanceGc: user.glowcoinBalance, transactions: rows.map(toTransaction) };
    },
  );

  /** Текущее размещение: последнее не истёкшее. Пишет в него этап 3. */
  fastify.get(
    '/billing/listing',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['billing'],
        response: { 200: currentListingSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const row = await fastify.prisma.listing.findFirst({
        where: { userId, status: { not: 'expired' } },
        orderBy: { createdAt: 'desc' },
      });
      return { listing: row ? toListing(row) : null };
    },
  );

  /**
   * Активация или продление размещения (этап 3). Цена — из прайса на
   * сервере по типу учётной записи и сроку; тело запроса несёт только срок.
   */
  fastify.post(
    '/billing/listings',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['billing'],
        body: activateListingInputSchema,
        response: { 200: activateListingResultSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, advertiserKind: true },
      });
      if (!user || user.role !== 'advertiser' || !user.advertiserKind) {
        throw fastify.httpErrors.forbidden('Размещение доступно только рекламодателю');
      }

      const config = await loadBillingConfig(fastify.prisma);
      const priceGc = config.prices[user.advertiserKind][request.body.term];

      try {
        const { result, restoredSlugs } = await activateListing(fastify.prisma, {
          userId,
          kind: user.advertiserKind,
          term: request.body.term,
          priceGc,
        });
        // Анкеты, вернувшиеся после неоплаты, должны появиться в каталоге
        // сразу, а не по истечении кэша.
        if (restoredSlugs.length > 0) {
          fastify.revalidate([PROFILES_TAG, ...restoredSlugs.map(profileTag)]);
        }
        return result;
      } catch (error) {
        if (error instanceof InsufficientBalanceError) {
          throw fastify.httpErrors.conflict(
            `Недостаточно GlowCoin: на балансе ${error.balance}, нужно ${error.requested}`,
          );
        }
        throw error;
      }
    },
  );

  // --- ТОП (payments.md §3.4) ----------------------------------------------

  fastify.get(
    '/billing/top',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['billing'], response: { 200: topStateSchema } },
    },
    async (request) => {
      const { userId, role } = requireSession(request);
      if (role !== 'advertiser') throw fastify.httpErrors.forbidden('ТОП доступен рекламодателю');
      const config = await loadBillingConfig(fastify.prisma);
      return topState(fastify.prisma, userId, config.top);
    },
  );

  /**
   * Покупка недели в ТОПе или продление. Цена и число мест — из прайса.
   * Листа ожидания нет: мест нет — 409, и человек пробует позже (D-10).
   */
  fastify.post(
    '/billing/top',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['billing'],
        body: buyTopInputSchema,
        response: { 200: buyTopResultSchema },
      },
    },
    async (request) => {
      const { userId, role } = requireSession(request);
      if (role !== 'advertiser') throw fastify.httpErrors.forbidden('ТОП доступен рекламодателю');
      const config = await loadBillingConfig(fastify.prisma);

      try {
        const result = await buyTop(fastify.prisma, {
          userId,
          profileId: request.body.profileId,
          priceGc: config.top.weekGc,
          slots: config.top.slots,
        });
        const profile = await fastify.prisma.profile.findUnique({
          where: { id: request.body.profileId },
          select: { slug: true },
        });
        // Место в ТОПе видно на главной и в сортировке каталога сразу.
        fastify.revalidate([PROFILES_TAG, ...(profile ? [profileTag(profile.slug)] : [])]);
        return result;
      } catch (error) {
        if (error instanceof TopFullError) {
          throw fastify.httpErrors.conflict(`Все ${error.slots} мест в ТОПе заняты`);
        }
        if (error instanceof TopNotPublishedError) {
          throw fastify.httpErrors.conflict(error.message);
        }
        if (error instanceof InsufficientBalanceError) {
          throw fastify.httpErrors.paymentRequired(
            `Недостаточно GlowCoin: на балансе ${error.balance}, нужно ${error.requested}`,
          );
        }
        throw error;
      }
    },
  );

  // --- Касса: Paymento (этап 4) -------------------------------------------

  fastify.post(
    '/billing/topups',
    {
      onRequest: fastify.requireAuth,
      // Каждый вызов создаёт платёж у поставщика: лимит защищает его и нас
      // от залипшей кнопки и от скрипта, плодящего заказы.
      config: { rateLimit: { max: 20, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['billing'],
        body: createTopupInputSchema,
        response: { 200: createTopupResultSchema },
      },
    },
    async (request) => {
      const { userId, role } = requireSession(request);
      if (role !== 'advertiser') {
        throw fastify.httpErrors.forbidden('Пополнение доступно только рекламодателю');
      }
      if (!isPaymentoConfigured()) {
        throw fastify.httpErrors.serviceUnavailable('Касса не настроена');
      }

      try {
        return await createTopupOrder(fastify.prisma, {
          userId,
          eur: request.body.eur,
          locale: request.body.locale,
        });
      } catch (error) {
        if (error instanceof TopupTierNotFoundError) {
          throw fastify.httpErrors.badRequest(error.message);
        }
        if (error instanceof PaymentoError) {
          request.log.error({ err: error }, 'Paymento не создал платёж');
          throw fastify.httpErrors.badGateway('Платёжный шлюз не ответил. Попробуйте позже.');
        }
        throw error;
      }
    },
  );

  /** Состояние заказа — страница возврата с кассы опрашивает его до зачисления. */
  fastify.get(
    '/billing/topups/:id',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['billing'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: topupOrderSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const order = await fastify.prisma.topupOrder.findFirst({
        where: { id: request.params.id, userId },
      });
      if (!order) throw fastify.httpErrors.notFound('Заказ не найден');
      return toTopupOrder(order);
    },
  );

  /**
   * Колбэк Paymento. Отдельный контекст: подпись считается от сырого тела,
   * а штатный парсер JSON его не сохраняет. Переопределяем парсер только
   * здесь — остальным маршрутам разобранное тело нужно как раньше.
   */
  await fastify.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    );

    scope.post(
      '/billing/webhook/paymento',
      {
        schema: {
          tags: ['billing'],
          response: { 200: z.object({ ok: z.literal(true), result: z.string() }) },
        },
      },
      async (request) => {
        const raw = typeof request.body === 'string' ? request.body : '';
        const signature = request.headers['x-hmac-sha256-signature'];
        if (!isPaymentoConfigured() || !isValidSignature(raw, signature, env.PAYMENTO_SECRET_KEY)) {
          request.log.warn('колбэк Paymento с неверной подписью');
          throw fastify.httpErrors.unauthorized('Неверная подпись');
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw fastify.httpErrors.badRequest('Тело не JSON');
        }
        const callback = parseCallback(parsed);
        if (!callback) throw fastify.httpErrors.badRequest('Неполный колбэк');

        // Ошибка verify или базы уходит 500: поставщик повторит доставку,
        // а зачисление идемпотентно — повтор безопасен.
        const result = await settleCallback(fastify.prisma, callback);
        request.log.info(
          { orderId: callback.orderId, providerStatus: callback.orderStatus, result },
          'колбэк Paymento обработан',
        );
        return { ok: true as const, result };
      },
    );
  });

  // --- Операции для админа (этап 6) ---------------------------------------

  /**
   * Поиск по заказам и движениям: по почте, номеру заказа или токену Paymento.
   * Один запрос на оба списка — «я заплатил, а GlowCoin нет» разбирают, глядя
   * на заказ и на журнал рядом.
   */
  fastify.get(
    '/admin/billing/operations',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        querystring: z.object({
          query: z.string().trim().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: billingOperationsSchema },
      },
    },
    async (request) => {
      const { query, limit } = request.query;
      const byEmail = query
        ? { user: { email: { contains: query, mode: 'insensitive' as const } } }
        : null;

      const [orders, transactions] = await Promise.all([
        fastify.prisma.topupOrder.findMany({
          where: query
            ? { OR: [{ id: query }, { providerToken: query }, ...(byEmail ? [byEmail] : [])] }
            : {},
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { user: { select: { email: true } } },
        }),
        fastify.prisma.billingTransaction.findMany({
          where: query
            ? { OR: [{ id: query }, { providerRef: query }, ...(byEmail ? [byEmail] : [])] }
            : {},
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: {
            user: { select: { email: true } },
            createdBy: { select: { email: true } },
          },
        }),
      ]);

      return {
        orders: orders.map((order) => ({
          ...toTopupOrder(order),
          email: order.user?.email ?? null,
          providerToken: order.providerToken,
          providerStatus: order.providerStatus,
        })),
        transactions: transactions.map((row) => ({
          ...toTransaction(row),
          email: row.user?.email ?? null,
          provider: row.provider,
          providerRef: row.providerRef,
          createdByEmail: row.createdBy?.email ?? null,
        })),
      };
    },
  );

  /** Выгрузка журнала за период — для бухгалтерии. Даты включительно. */
  fastify.get(
    '/admin/billing/transactions.csv',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        querystring: z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      },
    },
    async (request, reply) => {
      const from = new Date(`${request.query.from}T00:00:00.000Z`);
      const to = new Date(`${request.query.to}T23:59:59.999Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw fastify.httpErrors.badRequest('Неверный период');
      }

      const rows = await fastify.prisma.billingTransaction.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
        take: 50_000,
        include: {
          user: { select: { email: true } },
          createdBy: { select: { email: true } },
        },
      });

      // Экранирование по RFC 4180: кавычки удваиваются, поле с запятой,
      // кавычкой или переводом строки берётся в кавычки.
      const cell = (value: string | number | null | undefined): string => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const header = [
        'created_at',
        'kind',
        'gc_amount',
        'eur_paid',
        'bonus_percent',
        'provider',
        'provider_ref',
        'user_email',
        'created_by',
        'note',
      ];
      const lines = rows.map((row) =>
        [
          row.createdAt.toISOString(),
          row.kind,
          row.gcAmount,
          row.eurPaidCents === null ? '' : (row.eurPaidCents / 100).toFixed(2),
          row.bonusPercent,
          row.provider,
          row.providerRef,
          row.user?.email ?? '',
          row.createdBy?.email ?? '',
          row.note,
        ]
          .map(cell)
          .join(','),
      );

      // BOM — чтобы Excel открыл UTF-8 с кириллицей без вопросов.
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="noova-glowcoin-${request.query.from}-${request.query.to}.csv"`,
        )
        .send(`\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`);
    },
  );

  /**
   * Ручная корректировка (`ADJUSTMENT`). Стоит раньше кассы намеренно: она
   * закрывает поддержку — компенсации, спорные случаи — и позволяет проверить
   * списания и продления, ещё не подключив провайдера.
   */
  fastify.post(
    '/admin/billing/adjust',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        body: adjustBalanceInputSchema,
        response: { 200: adjustBalanceResultSchema },
      },
    },
    async (request) => {
      const { userId: adminId } = requireSession(request);
      const { userId, gcAmount, note } = request.body;

      const target = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!target) throw fastify.httpErrors.notFound('Пользователь не найден');
      if (target.role !== 'advertiser') {
        throw fastify.httpErrors.conflict('GlowCoin есть только у рекламодателя');
      }

      try {
        return await applyTransaction(fastify.prisma, {
          userId,
          kind: 'ADJUSTMENT',
          gcAmount,
          note,
          createdById: adminId,
        });
      } catch (error) {
        if (error instanceof InsufficientBalanceError) {
          // Числа в сообщении: без них админ пойдёт искать баланс отдельно.
          throw fastify.httpErrors.conflict(
            `Недостаточно GlowCoin: на балансе ${error.balance}, списание ${error.requested}`,
          );
        }
        if (error instanceof WalletOwnerNotFoundError) {
          throw fastify.httpErrors.notFound(error.message);
        }
        throw error;
      }
    },
  );
};
