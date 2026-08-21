import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Отметка «был активен». Раньше `lastSeenAt` писал только сид, поэтому бейдж
 * «Онлайн» гас через десять минут после сева и больше не появлялся, а фильтр
 * «онлайн сейчас» всегда возвращал пустоту.
 *
 * Активность владельца — это любой его запрос к своему кабинету. Писать в БД
 * на каждый запрос нельзя: это лишняя запись на каждое движение мышью,
 * поэтому отметка throttled через Redis.
 */
const TOUCH_INTERVAL_SECONDS = 120;

const presencePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onResponse', async (request) => {
    const session = request.session;
    if (session?.role !== 'advertiser') return;

    const key = `seen:${session.userId}`;
    try {
      // NX + EX: ключ ставится только если его не было, и сам протухает.
      // Пока он жив, в БД не пишем.
      const acquired = await fastify.redis.set(key, '1', 'EX', TOUCH_INTERVAL_SECONDS, 'NX');
      if (acquired !== 'OK') return;

      await fastify.prisma.profile.updateMany({
        where: { ownerId: session.userId, status: 'published' },
        data: { lastSeenAt: new Date() },
      });
    } catch (error) {
      // Отметка присутствия не стоит того, чтобы ронять ответ.
      fastify.log.warn({ err: error }, 'не удалось отметить активность');
    }
  });
};

export default fp(presencePlugin, { name: 'presence', dependencies: ['redis', 'session'] });
