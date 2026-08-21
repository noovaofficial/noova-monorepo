import { buildApp } from './app.js';
import { env } from './env.js';

const app = await buildApp();

/**
 * Аккуратная остановка: даём Fastify дослать текущие ответы и закрыть пул
 * соединений с БД, иначе при редеплое часть запросов обрывается на клиенте.
 */
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'останавливаем сервер');
  const forceExit = setTimeout(() => {
    app.log.error('graceful shutdown не уложился в 10s, выходим принудительно');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'ошибка при остановке');
    process.exit(1);
  }
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  app.log.fatal({ err: reason }, 'unhandledRejection');
  void shutdown('unhandledRejection');
});

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.fatal({ err: error }, 'не удалось запустить сервер');
  process.exit(1);
}
