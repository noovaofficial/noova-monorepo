import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Чистка журнала раскрытий. Записи нужны как антифрод и как статистика
 * откликов, но бессрочно хранить след «этот адрес смотрел эту анкету» нельзя:
 * журнал сам становится базой персональных данных. Срок приходит из
 * конфигурации — см. `jobs/tasks.ts`.
 */
export async function purgeContactReveals(
  prisma: PrismaClient,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.contactReveal.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
