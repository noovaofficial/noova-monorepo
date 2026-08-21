import { createProfileReportSchema, isUrgentReason, slugSchema } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashIp } from '../profiles/reveal.js';

export const reportRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/profiles/:slug/reports',
    {
      /**
       * Вход не требуется. Заставлять регистрироваться того, кто увидел
       * признаки принуждения или несовершеннолетнюю, — значит такого
       * сообщения не получить; цена ошибки здесь несопоставима с ценой спама.
       * Сдерживание — лимит на IP и журнал, как у раскрытия контактов (N-08).
       *
       * `allowList` глушим: освобождение существует ради серверного рендера,
       * а он жалоб не подаёт.
       */
      config: { rateLimit: { max: 10, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['reports'],
        params: z.object({ slug: slugSchema }),
        body: createProfileReportSchema,
        response: { 201: z.object({ id: z.string(), isUrgent: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const profile = await fastify.prisma.profile.findFirst({
        where: { slug: request.params.slug, status: 'published' },
        select: { id: true },
      });
      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');

      const created = await fastify.prisma.profileReport.create({
        data: {
          profileId: profile.id,
          // Сессия читается на каждом запросе и здесь просто может отсутствовать.
          reporterId: request.session?.userId ?? null,
          ipHash: hashIp(request.ip),
          reason: request.body.reason,
          details: request.body.details,
        },
        select: { id: true, reason: true },
      });

      // Анкета не снимается и не прячется: автоснятие по счётчику жалоб —
      // готовый инструмент травли конкурентами. Решение принимает человек.
      return reply.status(201).send({
        id: created.id,
        isUrgent: isUrgentReason(created.reason),
      });
    },
  );
};
