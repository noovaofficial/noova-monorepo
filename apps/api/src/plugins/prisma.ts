import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { PrismaClient } from '../generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Подключение с ретраями и экспоненциальной паузой: контейнер API стартует
 * раньше, чем Postgres готов принимать соединения, и падать из-за этого он
 * не должен. Тот же путь отрабатывает при кратковременной потере БД.
 */
async function connectWithRetry(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  attempts = 10,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$connect();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      log.warn({ attempt, delayMs }, 'БД недоступна, повтор подключения');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const prismaPlugin: FastifyPluginAsync = async (fastify) => {
  // Prisma 7 подключается через драйвер-адаптер, строку берём из окружения.
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

  await connectWithRetry(prisma, fastify.log);

  fastify.decorate('prisma', prisma);
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
