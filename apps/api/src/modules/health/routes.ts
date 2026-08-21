import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/**
 * `/healthz` — liveness: процесс жив, никуда не ходим.
 * `/readyz`  — readiness: проверяем БД, оркестратор по этому роуту решает,
 *              можно ли слать трафик на контейнер.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/healthz',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        response: { 200: z.object({ status: z.literal('ok'), uptime: z.number() }) },
      },
    },
    async () => ({ status: 'ok' as const, uptime: process.uptime() }),
  );

  fastify.get(
    '/readyz',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        response: {
          200: z.object({ status: z.literal('ready'), db: z.literal('up') }),
          503: z.object({ status: z.literal('degraded'), db: z.literal('down') }),
        },
      },
    },
    async (_request, reply) => {
      try {
        await fastify.prisma.$queryRaw`SELECT 1`;
        return { status: 'ready' as const, db: 'up' as const };
      } catch (error) {
        fastify.log.error({ err: error }, 'readiness: БД недоступна');
        return reply.status(503).send({ status: 'degraded' as const, db: 'down' as const });
      }
    },
  );
};
