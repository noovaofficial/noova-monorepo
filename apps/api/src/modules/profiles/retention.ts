import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Чистка журнала событий анкет. Записи нужны как антифрод по раскрытиям и
 * как статистика для владелицы, но бессрочно хранить след «этот адрес
 * смотрел эту анкету» нельзя: журнал сам становится базой персональных
 * данных. Срок приходит из конфигурации — см. `jobs/tasks.ts`.
 *
 * Он же задаёт потолок глубины отчёта: показывать в кабинете период длиннее
 * срока хранения значит рисовать нули там, где данные были и удалены нами.
 */
export async function purgeProfileEvents(
  prisma: PrismaClient,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.profileEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
