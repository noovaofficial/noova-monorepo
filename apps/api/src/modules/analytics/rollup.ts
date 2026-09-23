import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { berlinDate, shiftDate } from './query.js';

const TZ = 'Europe/Berlin';

/** Сколько последних суток пересчитываем каждый цикл: сегодня (события ещё
 *  идут) и вчера (хвост после полуночи и запоздавшие записи). */
const RECENT_DAYS = 2;

/** Окно заполнения задним числом. Небольшое, чтобы один запрос не держал
 *  блокировки и не грузил БД дольше, чем стоит. */
const BACKFILL_CHUNK_DAYS = 7;

/**
 * Пересчитывает суточные счётчики за [fromDay, toDay] (берлинские даты,
 * включительно). Идемпотентно: строка за день перезаписывается целиком.
 *
 * Собственные обращения владельца исключены — как и в отчёте самого
 * рекламодателя (`loadAnalytics`): иначе его проверки своей анкеты попадали бы
 * в «интерес клиентов». Границы суток и сдвиг часового пояса — по той же
 * схеме, что и там: сначала объявить время UTC, затем перевести в Берлин.
 */
export async function rollupEventDays(
  prisma: PrismaClient,
  fromDay: string,
  toDay: string,
): Promise<number> {
  const since = Prisma.sql`((${fromDay}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;
  const until = Prisma.sql`((${shiftDate(toDay, 1)}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;

  return prisma.$executeRaw`
    INSERT INTO "ProfileEventDaily" ("profileId", "day", "kind", "registered", "anonymous")
    SELECT e."profileId",
           (e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date AS day,
           e."kind",
           count(*) FILTER (WHERE e."userId" IS NOT NULL)::int,
           count(*) FILTER (WHERE e."userId" IS NULL)::int
      FROM "ProfileEvent" e
      JOIN "Profile" p ON p."id" = e."profileId"
     WHERE e."createdAt" >= ${since}
       AND e."createdAt" < ${until}
       AND (e."userId" IS NULL OR e."userId" <> p."ownerId")
     GROUP BY 1, 2, 3
    ON CONFLICT ("profileId", "day", "kind")
    DO UPDATE SET "registered" = EXCLUDED."registered", "anonymous" = EXCLUDED."anonymous"
  `;
}

/**
 * Цикл задачи: последние сутки пересчитываем всегда, а если таблица пуста —
 * сперва заполняем всю доступную историю сырого журнала окнами по неделе.
 * Возвращает число записанных строк.
 */
export async function runEventRollup(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const today = berlinDate(now);
  let written = 0;

  const rolled = await prisma.profileEventDaily.findFirst({ select: { day: true } });
  if (!rolled) {
    const first = await prisma.profileEvent.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (first) {
      const start = berlinDate(first.createdAt);
      const backfillEnd = shiftDate(today, -RECENT_DAYS);
      for (let from = start; from <= backfillEnd; from = shiftDate(from, BACKFILL_CHUNK_DAYS)) {
        const to = shiftDate(from, BACKFILL_CHUNK_DAYS - 1);
        written += await rollupEventDays(prisma, from, to > backfillEnd ? backfillEnd : to);
      }
    }
  }

  written += await rollupEventDays(prisma, shiftDate(today, -(RECENT_DAYS - 1)), today);
  return written;
}
