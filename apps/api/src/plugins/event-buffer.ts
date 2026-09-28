import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { EventBuffer } from '../modules/analytics/buffer.js';

declare module 'fastify' {
  interface FastifyInstance {
    eventBuffer: EventBuffer;
  }
}

/**
 * Буфер батчевых событий (фаза 1) — один на процесс, живёт от старта до
 * остановки. `onClose` сбрасывает остаток перед завершением: без этого
 * события последней неполной секунды терялись бы при каждом деплое.
 */
const eventBufferPlugin: FastifyPluginAsync = async (fastify) => {
  const buffer = new EventBuffer(fastify.prisma, fastify.log);
  fastify.decorate('eventBuffer', buffer);
  fastify.addHook('onClose', async () => {
    await buffer.flush();
  });
};

export default fp(eventBufferPlugin, { name: 'event-buffer', dependencies: ['prisma'] });
