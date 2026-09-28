import { CONTACT_EVENT_KINDS } from '@noova/shared';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { berlinDate, FUNNEL_KINDS, shiftDate } from './query.js';

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
 * в «интерес клиентов». Помеченные ботом (фаза 3) исключены по той же
 * причине: они не удалены из журнала, но роллап и кабинет их не считают.
 * `page_view`, `gallery_open` и `search_filter` (батч `/api/e`) сюда тоже
 * не идут — эта таблица держит воронку той же анкеты, что и кабинет
 * (`FUNNEL_KINDS`), а не события каталога.
 * Границы суток и сдвиг часового пояса — по той же схеме, что и там:
 * сначала объявить время UTC, затем перевести в Берлин.
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
       AND e."kind" = ANY(${FUNNEL_KINDS}::"ProfileEventKind"[])
       AND e."isBot" = FALSE
       AND (e."userId" IS NULL OR e."userId" <> p."ownerId")
     GROUP BY 1, 2, 3
    ON CONFLICT ("profileId", "day", "kind")
    DO UPDATE SET "registered" = EXCLUDED."registered", "anonymous" = EXCLUDED."anonymous"
  `;
}

/**
 * Пересчитывает трафик по источнику за [fromDay, toDay]. Сутки — по началу
 * сессии (`startedAt`), а не по времени отдельных событий: разрез держит
 * сессию целиком, и контакт, случившийся уже за полночь той же сессии,
 * всё равно её день, а не следующий.
 *
 * `sessions` считает и ботов — это знаменатель для их доли (фаза 3,
 * `botSessions / sessions`); `contacts` — только настоящие обращения:
 * попади сюда боты, стоимость контакта в фазе 6 (join с расходом сети)
 * была бы занижена на их долю. `LEFT JOIN` с `ProfileEvent` не даёт
 * задвоения по сессиям: `sessions`/`botSessions` считают `DISTINCT s.id`,
 * а `contacts` — сами строки событий, которых на сессию может быть много.
 */
export async function rollupSourceDays(
  prisma: PrismaClient,
  fromDay: string,
  toDay: string,
): Promise<number> {
  const since = Prisma.sql`((${fromDay}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;
  const until = Prisma.sql`((${shiftDate(toDay, 1)}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;

  return prisma.$executeRaw`
    INSERT INTO "SourceDailyStat" ("day", "source", "network", "utmCampaign", "sessions", "botSessions", "contacts")
    SELECT (s."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date AS day,
           s."source",
           COALESCE(s."network", ''),
           COALESCE(s."utmCampaign", ''),
           count(DISTINCT s."id")::int,
           count(DISTINCT s."id") FILTER (WHERE s."isBot")::int,
           count(e."id") FILTER (
             WHERE e."kind" = ANY(${CONTACT_EVENT_KINDS}::"ProfileEventKind"[]) AND e."isBot" = FALSE
           )::int
      FROM "AnalyticsSession" s
      LEFT JOIN "ProfileEvent" e ON e."sessionId" = s."id"
     WHERE s."startedAt" >= ${since}
       AND s."startedAt" < ${until}
     GROUP BY 1, 2, 3, 4
    ON CONFLICT ("day", "source", "network", "utmCampaign")
    DO UPDATE SET
      "sessions" = EXCLUDED."sessions",
      "botSessions" = EXCLUDED."botSessions",
      "contacts" = EXCLUDED."contacts"
  `;
}

/**
 * Пересчитывает трафик и просмотры по городу и категории за
 * [fromDay, toDay] — по `ProfileEvent.city`/`category`, а не по анкете:
 * так же считаются и события без анкеты (`page_view`, часть
 * `search_filter`, когда страница передаёт город). События без города или
 * категории (главная, поиск «вся страна») в эту таблицу не попадают —
 * агрегировать «неизвестно» вместе с городами смысла нет.
 *
 * `sessions` здесь не то же самое, что в `SourceDailyStat`: это число
 * сессий, у которых хоть одно событие пришлось на этот город и категорию, —
 * посетитель, посмотревший два города, войдёт в обе строки.
 *
 * Не трогает `activeProfiles` этих строк: снимок пишет отдельная функция
 * (`rollupActiveProfiles`), и объединять их в один INSERT означало бы, что
 * при пересчёте трафика без пересчёта снимка (или наоборот) вторая половина
 * строки обнулялась бы вместо того, чтобы остаться как есть.
 */
export async function rollupCityDays(
  prisma: PrismaClient,
  fromDay: string,
  toDay: string,
): Promise<number> {
  const since = Prisma.sql`((${fromDay}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;
  const until = Prisma.sql`((${shiftDate(toDay, 1)}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;

  return prisma.$executeRaw`
    INSERT INTO "CityDailyStat" ("day", "city", "category", "sessions", "profileViews", "contacts", "activeProfiles")
    SELECT (e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date AS day,
           e."city",
           e."category",
           count(DISTINCT e."sessionId")::int,
           count(*) FILTER (WHERE e."kind" = 'view'::"ProfileEventKind")::int,
           count(*) FILTER (WHERE e."kind" = ANY(${CONTACT_EVENT_KINDS}::"ProfileEventKind"[]))::int,
           0
      FROM "ProfileEvent" e
     WHERE e."createdAt" >= ${since}
       AND e."createdAt" < ${until}
       AND e."isBot" = FALSE
       AND e."city" IS NOT NULL
       AND e."category" IS NOT NULL
     GROUP BY 1, 2, 3
    ON CONFLICT ("day", "city", "category")
    DO UPDATE SET
      "sessions" = EXCLUDED."sessions",
      "profileViews" = EXCLUDED."profileViews",
      "contacts" = EXCLUDED."contacts"
  `;
}

/**
 * Снимок «сколько анкет сейчас размещено» по городу и категории, записанный
 * в строки [fromDay, toDay]. Это текущее состояние `Profile`, не история:
 * у прошлых дат до появления собственной истории размещений другого источника
 * правды нет (см. комментарий у `CityDailyStat` в схеме). Отдельная функция,
 * а не часть `rollupCityDays`: город без единого события за день (пока)
 * должен получить строку с одними активными анкетами и нулями трафика, а не
 * остаться без строки вовсе.
 */
export async function rollupActiveProfiles(
  prisma: PrismaClient,
  fromDay: string,
  toDay: string,
): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO "CityDailyStat" ("day", "city", "category", "sessions", "profileViews", "contacts", "activeProfiles")
    SELECT d::date, snap."city", snap."category", 0, 0, 0, snap."n"
      FROM generate_series(${fromDay}::date, ${toDay}::date, interval '1 day') AS d
      CROSS JOIN (
        SELECT c."slug" AS "city", p."kind"::text AS "category", count(*)::int AS "n"
          FROM "Profile" p
          JOIN "City" c ON c."id" = p."cityId"
         WHERE p."status" = 'published'::"ProfileStatus"
         GROUP BY 1, 2
      ) AS snap
    ON CONFLICT ("day", "city", "category")
    DO UPDATE SET "activeProfiles" = EXCLUDED."activeProfiles"
  `;
}

/**
 * Цикл задачи: последние сутки пересчитываем всегда, а если таблица пуста —
 * сперва заполняем всю доступную историю сырого журнала окнами по неделе.
 * Все четыре роллапа (воронка анкеты, источники, города, снимок анкет)
 * идут по одним и тем же окнам — иначе для одного и того же дня существовали
 * бы два разных ответа на вопрос «пересчитан ли он». Возвращает число
 * записанных строк.
 */
export async function runEventRollup(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const today = berlinDate(now);
  let written = 0;

  const rollupWindow = async (from: string, to: string): Promise<number> =>
    (await rollupEventDays(prisma, from, to)) +
    (await rollupSourceDays(prisma, from, to)) +
    (await rollupCityDays(prisma, from, to)) +
    (await rollupActiveProfiles(prisma, from, to));

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
        written += await rollupWindow(from, to > backfillEnd ? backfillEnd : to);
      }
    }
  }

  written += await rollupWindow(shiftDate(today, -(RECENT_DAYS - 1)), today);
  return written;
}
