import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { env } from '../env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { loggerOptions } from '../logger.js';
import { JOBS, type JobDeps } from './tasks.js';

const log = pino({ ...loggerOptions, name: 'jobs' });

/**
 * Замок на цикл. Задачи идемпотентны — повторное удаление уже удалённого
 * ничего не портит, — но два процесса, одновременно перебирающие фотографии
 * и удаляющие объекты из хранилища, будут мешать друг другу и шуметь
 * ошибками «объект не найден». Дешевле не пускать второго.
 *
 * TTL заведомо больше цикла: если процесс умрёт, не сняв замок, следующий
 * запуск подождёт не дольше этого срока.
 */
const LOCK_KEY = 'jobs:retention:lock';
const LOCK_TTL_SECONDS = 15 * 60;

export type JobResult = { name: string; removed: number } | { name: string; error: string };

/**
 * Один проход по всем задачам. Ошибка одной не отменяет остальные: чистка
 * фотографий зависит от хранилища, чистка журналов — только от БД, и
 * недоступность MinIO не должна означать, что журналы копятся дальше.
 */
export async function runAllJobs(prisma: PrismaClient, deps: JobDeps = {}): Promise<JobResult[]> {
  const results: JobResult[] = [];

  for (const job of JOBS) {
    const startedAt = Date.now();
    try {
      const removed = await job.run(prisma, deps);
      results.push({ name: job.name, removed });
      // Логируем и ноль: молчаливая чистка неотличима от незапущенной, и
      // «почему база растёт» тогда некуда посмотреть.
      log.info({ job: job.name, removed, ms: Date.now() - startedAt }, 'чистка выполнена');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: job.name, error: message });
      log.error({ job: job.name, err: error }, 'чистка не выполнена');
    }
  }

  return results;
}

async function runCycle(prisma: PrismaClient, redis: Redis): Promise<void> {
  const acquired = await redis.set(LOCK_KEY, process.pid.toString(), 'EX', LOCK_TTL_SECONDS, 'NX');
  if (acquired !== 'OK') {
    log.info('цикл пропущен: замок занят другим процессом');
    return;
  }

  try {
    await runAllJobs(prisma, { redis });
  } finally {
    // Снимаем замок сами, не дожидаясь TTL: иначе следующий цикл через час
    // упрётся в собственный незакрытый замок.
    await redis.del(LOCK_KEY).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

  let stopping = false;
  let timer: NodeJS.Timeout | null = null;

  const shutdown = async (signal: string) => {
    stopping = true;
    if (timer) clearTimeout(timer);
    log.info({ signal }, 'остановка');
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info({ intervalSeconds: env.JOBS_INTERVAL_SECONDS, jobs: JOBS.map((j) => j.name) }, 'старт');

  // Цикл, а не cron: у контейнера нет своего планировщика, а рассчитывать на
  // хостовый cron значит завязать чистку на настройку конкретной машины.
  while (!stopping) {
    try {
      await runCycle(prisma, redis);
    } catch (error) {
      // Падение цикла целиком (например, недоступна БД) не должно ронять
      // процесс: следующий заход через интервал может пройти успешно.
      log.error({ err: error }, 'цикл завершился ошибкой');
    }

    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, env.JOBS_INTERVAL_SECONDS * 1000);
    });
  }
}

// Запускается только как самостоятельный процесс: импорт модуля (например,
// тестами) цикл не стартует.
if (process.argv[1]?.includes('jobs/runner')) {
  main().catch((error) => {
    log.fatal({ err: error }, 'не удалось запустить фоновые задачи');
    process.exit(1);
  });
}
