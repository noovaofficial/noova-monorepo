import {
  analyticsPeriodSchema,
  analyticsSchema,
  slugSchema,
  trackClickSchema,
} from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSession } from '../../plugins/session.js';
import { recordProfileEvent } from './events.js';
import { loadAnalytics } from './query.js';

/**
 * Событие пишется только опубликованной анкете. Черновик и снятая наружу
 * не видны вовсе, и статистика по ним была бы либо мусором из перебора id,
 * либо подсказкой о том, что такая анкета существует.
 */
async function publishedProfileOr404(fastify: FastifyInstance, slug: string) {
  const profile = await fastify.prisma.profile.findFirst({
    where: { slug, status: 'published' },
    select: { id: true },
  });
  if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');
  return profile;
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
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const profile = await publishedProfileOr404(fastify, request.params.slug);
      await recordProfileEvent(fastify, request, { kind: 'view', profileId: profile.id });
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
        body: trackClickSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const profile = await publishedProfileOr404(fastify, request.params.slug);
      await recordProfileEvent(fastify, request, {
        kind: 'contact_click',
        profileId: profile.id,
        contactType: request.body.type,
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

      return loadAnalytics(fastify.prisma, { profiles, ownerId: userId }, request.query.period);
    },
  );
};
