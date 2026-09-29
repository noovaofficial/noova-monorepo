import {
  ANALYTICS_PERIOD_DAYS,
  analyticsPeriodSchema,
  analyticsSchema,
  eventBatchSchema,
  ownMoneyAnalyticsSchema,
  slugSchema,
  trackClickSchema,
  trackEventContextSchema,
  trackSessionSchema,
} from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSession } from '../../plugins/session.js';
import { loadMoney, toOwnMoney } from './admin-money.js';
import { recordEventBatch } from './batch.js';
import { recordProfileEvent } from './events.js';
import { loadPromotionEffects } from './promotion.js';
import { loadAnalytics } from './query.js';
import { recordSession } from './session.js';

/**
 * Событие пишется только опубликованной анкете. Черновик и снятая наружу
 * не видны вовсе, и статистика по ним была бы либо мусором из перебора id,
 * либо подсказкой о том, что такая анкета существует.
 */
async function publishedProfileOr404(fastify: FastifyInstance, slug: string) {
  const profile = await fastify.prisma.profile.findFirst({
    where: { slug, status: 'published' },
    select: { id: true, kind: true, city: { select: { slug: true } } },
  });
  if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');
  return { id: profile.id, city: profile.city.slug, category: profile.kind };
}

export const analyticsRoutes: FastifyPluginAsyncZod = async (fastify) => {
  /**
   * Маяк просмотра.
   *
   * Отдельный запрос из браузера, а не счётчик на рендере: страница анкеты
   * отдаётся из кэша (ISR, `revalidate = 600`), и серверный рендер случается
   * заметно реже захода. Считая по нему, мы считали бы не посетителей, а то,
   * как часто протухает кэш.
   *
   * Ответ всегда 204 и без тела: маяк уходит из `useEffect`, ответа никто
   * не ждёт, и рассказывать в нём про дедупликацию некому.
   */
  fastify.post(
    '/profiles/:slug/view',
    {
      /**
       * Своего лимита нет — работает общий, 120 запросов в минуту на адрес.
       * Часовой лимит на адрес, как у раскрытия контактов, здесь был бы
       * ошибкой: за одним адресом мобильного оператора сидят тысячи людей,
       * и такой потолок молча выбрасывал бы просмотры целой сети — ровно те
       * данные, ради которых страница и существует. Настоящее сдерживание
       * тут другое: окно дедупликации, из-за которого один посетитель
       * прибавляет анкете не больше одного просмотра в полчаса.
       */
      schema: {
        tags: ['analytics'],
        params: z.object({ slug: slugSchema }),
        body: trackEventContextSchema.optional(),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const profile = await publishedProfileOr404(fastify, request.params.slug);
      await recordProfileEvent(fastify, request, {
        kind: 'view',
        profileId: profile.id,
        city: profile.city,
        category: profile.category,
        sessionId: request.body?.sessionId,
      });
      return reply.status(204).send(null);
    },
  );

  /**
   * Батч каталожных событий (фаза 1): заходы на страницы без анкеты
   * (город, категория, поиск, главная), открытие галереи, применение
   * фильтра. Ответ всегда 204 сразу — запись в базу идёт из буфера
   * (`fastify.eventBuffer`) отдельным циклом, а не в рамках этого запроса.
   *
   * Своего лимита на размер тела не заводим сверх схемы (не больше 50
   * событий): достаточно единого лимита на частоту самих батчей внутри
   * `recordEventBatch`.
   */
  fastify.post(
    '/e',
    {
      // Свой (молчаливый) лимит по батчам — внутри `recordEventBatch`.
      // Общий лимит плагина `rate-limit` тут не годится: он ответил бы 429,
      // а лишний батч трекера должен просто пропасть без ответа-ошибки.
      config: { rateLimit: false },
      schema: {
        tags: ['analytics'],
        body: eventBatchSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      try {
        await recordEventBatch(fastify, request, request.body);
      } catch (error) {
        fastify.log.warn({ err: error }, 'не удалось записать батч событий');
      }
      return reply.status(204).send(null);
    },
  );

  /**
   * Начало сессии: откуда пришёл посетитель. Браузер шлёт один раз за
   * сессию, на первой странице. Ответ всегда 204: повтор с тем же
   * идентификатором молча игнорируется, и рассказывать об этом клиенту
   * незачем. Сбой записи не роняет ответ — как и у остальных маяков.
   */
  fastify.post(
    '/analytics/session',
    {
      schema: {
        tags: ['analytics'],
        body: trackSessionSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      try {
        await recordSession(fastify.prisma, request, request.body);
      } catch (error) {
        fastify.log.warn({ err: error }, 'не удалось записать сессию');
      }
      return reply.status(204).send(null);
    },
  );

  /**
   * Переход по контакту. Отличается от раскрытия тем же, чем «увидел номер»
   * отличается от «набрал»: между ними отваливается половина, и владелице
   * важно видеть обе ступени, а не одну.
   */
  fastify.post(
    '/profiles/:slug/contacts/click',
    {
      // Лимит общий, по той же причине, что и у просмотра.
      schema: {
        tags: ['analytics'],
        params: z.object({ slug: slugSchema }),
        body: trackClickSchema.extend(trackEventContextSchema.shape),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const profile = await publishedProfileOr404(fastify, request.params.slug);
      await recordProfileEvent(fastify, request, {
        kind: 'contact_click',
        profileId: profile.id,
        contactType: request.body.type,
        city: profile.city,
        category: profile.category,
        sessionId: request.body.sessionId,
        interacted: request.body.interacted,
        msSincePageLoad: request.body.msSincePageLoad,
      });
      return reply.status(204).send(null);
    },
  );

  /**
   * Отчёт владельца. Роль, а не просто наличие сессии: статистика анкеты —
   * это данные о её посетителях, и отдавать их клиенту или чужому
   * рекламодателю нельзя. Выборка идёт по `ownerId`, поэтому чужие анкеты
   * в неё не попадают в принципе.
   */
  fastify.get(
    '/me/analytics',
    {
      onRequest: fastify.requireRole('advertiser'),
      schema: {
        tags: ['analytics'],
        querystring: z.object({ period: analyticsPeriodSchema.default('d30') }),
        response: { 200: analyticsSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);

      /**
       * Черновики и снятые анкеты в отчёте участвуют: у снятой за неоплату
       * есть история просмотров, и убрать её из отчёта значило бы показать
       * владелице падение до нуля вместо причины.
       */
      const profiles = await fastify.prisma.profile.findMany({
        where: { ownerId: userId },
        select: { id: true, displayName: true, slug: true },
        orderBy: { createdAt: 'asc' },
      });

      const scope = { profiles, ownerId: userId };
      // Эффект ТОПа не зависит от выбранного периода (см. `promotion.ts`),
      // поэтому считается отдельным запросом, а не частью `loadAnalytics`.
      const [analytics, promotions] = await Promise.all([
        loadAnalytics(fastify.prisma, scope, request.query.period),
        loadPromotionEffects(fastify.prisma, scope),
      ]);
      return { ...analytics, promotions };
    },
  );

  /**
   * Деньги самого рекламодателя: внесено, коины, траты, баланс и срок
   * размещения. Урезанный вид админского отчёта (`toOwnMoney`): разбивка
   * подарков по источнику и тариф агентства остаются только админу. Свой
   * `userId` берём из сессии — чужой запросить нельзя.
   */
  fastify.get(
    '/me/analytics/money',
    {
      onRequest: fastify.requireRole('advertiser'),
      schema: {
        tags: ['analytics'],
        querystring: z.object({ period: analyticsPeriodSchema.default('d30') }),
        response: { 200: ownMoneyAnalyticsSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const since = new Date(
        Date.now() - ANALYTICS_PERIOD_DAYS[request.query.period] * 24 * 60 * 60 * 1000,
      );

      const [money, user, listing] = await Promise.all([
        loadMoney(fastify.prisma, userId, since),
        fastify.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { glowcoinBalance: true },
        }),
        fastify.prisma.listing.findFirst({
          where: { userId },
          orderBy: { expiresAt: 'desc' },
          select: { status: true, term: true, expiresAt: true },
        }),
      ]);

      return {
        balanceGc: user.glowcoinBalance,
        listing: listing
          ? {
              status: listing.status,
              term: listing.term,
              expiresAt: listing.expiresAt.toISOString(),
            }
          : null,
        period: toOwnMoney(money.period),
        allTime: toOwnMoney(money.allTime),
      };
    },
  );
};
