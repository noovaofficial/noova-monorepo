import {
  createProfileReportSchema,
  isUrgentReason,
  slugSchema,
  URGENT_REPORT_REASONS,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rateLimitKey } from '../../plugins/security.js';
import { hashIp } from '../analytics/events.js';
import { reportDecision } from './dedupe.js';

export const reportRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/profiles/:slug/reports',
    {
      /**
       * Вход не требуется. Заставлять регистрироваться того, кто увидел
       * признаки принуждения или несовершеннолетнюю, — значит такого
       * сообщения не получить; цена ошибки здесь несопоставима с ценой спама.
       * Сдерживание — лимит на IP, журнал и потолок незакрытых жалоб на
       * анкету (dedupe.ts).
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

      const urgent = isUrgentReason(request.body.reason);
      const sameClass = {
        resolvedAt: null,
        reason: urgent ? { in: [...URGENT_REPORT_REASONS] } : { notIn: [...URGENT_REPORT_REASONS] },
      };
      const reporterId = request.session?.userId ?? null;
      // Подсеть, а не адрес: в IPv6 у одного абонента их 2^64.
      const ipHash = hashIp(rateLimitKey(request.ip));

      // Правила — в dedupe.ts. Под замком на анкету: иначе пачка
      // одновременных жалоб прошла бы проверку вся разом.
      const created = await fastify.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report:${profile.id}`}))`;
        const [mine, openCount] = await Promise.all([
          tx.profileReport.findFirst({
            where: {
              profileId: profile.id,
              ...sameClass,
              OR: [{ ipHash }, ...(reporterId ? [{ reporterId }] : [])],
            },
            select: { id: true, reason: true },
          }),
          tx.profileReport.count({ where: { profileId: profile.id, ...sameClass } }),
        ]);
        const decision = reportDecision({ urgent, senderHasOpen: mine !== null, openCount });
        if (decision === 'duplicate' && mine) return mine;
        if (decision === 'full') {
          request.log.warn({ profileId: profile.id, urgent, openCount }, 'жалоба сверх потолка');
          // Отвечаем как обычно; своей записи у отправителя нет, id — пустой.
          return { id: '', reason: request.body.reason };
        }
        return tx.profileReport.create({
          data: {
            profileId: profile.id,
            reporterId,
            ipHash,
            reason: request.body.reason,
            details: request.body.details,
          },
          select: { id: true, reason: true },
        });
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
