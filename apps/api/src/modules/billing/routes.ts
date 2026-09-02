import {
  activateListingInputSchema,
  activateListingResultSchema,
  adjustBalanceInputSchema,
  adjustBalanceResultSchema,
  billingConfigInputSchema,
  createTopupInputSchema,
  createTopupResultSchema,
  currentListingSchema,
  priceBookSchema,
  toPriceBook,
  topupOrderSchema,
  walletSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../env.js';
import { BILLING_TAG } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { loadBillingConfig, saveBillingConfig } from './config.js';
import { activateListing } from './listing.js';
import {
  isPaymentoConfigured,
  isValidSignature,
  PaymentoError,
  parseCallback,
} from './paymento.js';
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
        return await activateListing(fastify.prisma, {
          userId,
          kind: user.advertiserKind,
          term: request.body.term,
          priceGc,
        });
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
