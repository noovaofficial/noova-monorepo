import {
  CONTACT_EVENT_KINDS,
  type TrafficQuality,
  type TrafficQualityArrival,
  type TrafficQualityQuery,
  type TrafficQualityTopVisitor,
} from '@noova/shared';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { shiftDate } from './query.js';

const TZ = 'Europe/Berlin';

/** Сколько устройств показываем в таблице — больше незачем: если накрутка
 *  есть, она видна в первых 20 строках, отсортированных по убыванию. */
const TOP_VISITORS_LIMIT = 20;

/**
 * Пять диагностических срезов за один берлинский день, один фильтр на все
 * пять — по `utm_campaign`, если задан. Выросло из разбора конкретного
 * случая руками (SQL в терминале); здесь то же самое, но по кнопке и без
 * доступа к базе напрямую.
 *
 * Сознательно НЕ читает роллапы (`SourceDailyStat` и т.п.): те усечены до
 * «контакты по источнику», а тут нужен именно сырой разрез по сессиям —
 * устройство, время, наличие событий. Эта цена (сканирование за один день,
 * не 90) и есть причина, почему это отдельная, запускаемая по требованию
 * проверка, а не часть обычного дашборда.
 */
export async function loadTrafficQuality(
  prisma: PrismaClient,
  query: TrafficQualityQuery,
): Promise<TrafficQuality> {
  const since = Prisma.sql`((${query.date}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;
  const until = Prisma.sql`((${shiftDate(query.date, 1)}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;
  const campaignFilter = query.utmCampaign
    ? Prisma.sql`AND "utmCampaign" = ${query.utmCampaign}`
    : Prisma.empty;

  const [overview, topVisitors, silent, funnel, arrivals] = await Promise.all([
    prisma.$queryRaw<{ sessions: number; distinctVisitors: number }[]>`
      SELECT count(*)::int AS sessions,
             count(DISTINCT "visitorHash")::int AS "distinctVisitors"
        FROM "AnalyticsSession"
       WHERE "startedAt" >= ${since} AND "startedAt" < ${until} ${campaignFilter}
    `,
    prisma.$queryRaw<TrafficQualityTopVisitor[]>`
      SELECT "visitorHash", "deviceType", count(*)::int AS sessions
        FROM "AnalyticsSession"
       WHERE "startedAt" >= ${since} AND "startedAt" < ${until} ${campaignFilter}
       GROUP BY 1, 2
       ORDER BY 3 DESC
       LIMIT ${TOP_VISITORS_LIMIT}
    `,
    prisma.$queryRaw<{ total: number; withoutEvents: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE NOT EXISTS (SELECT 1 FROM "ProfileEvent" e WHERE e."sessionId" = s.id)
             )::int AS "withoutEvents"
        FROM "AnalyticsSession" s
       WHERE s."startedAt" >= ${since} AND s."startedAt" < ${until} ${campaignFilter}
    `,
    prisma.$queryRaw<{ sessionsWithActivity: number; views: number; contacts: number }[]>`
      SELECT count(DISTINCT e."sessionId")::int AS "sessionsWithActivity",
             count(*) FILTER (WHERE e."kind" = 'view'::"ProfileEventKind")::int AS views,
             count(*) FILTER (
               WHERE e."kind" = ANY(${CONTACT_EVENT_KINDS}::"ProfileEventKind"[])
             )::int AS contacts
        FROM "AnalyticsSession" s
        JOIN "ProfileEvent" e ON e."sessionId" = s.id AND e."isBot" = FALSE
       WHERE s."startedAt" >= ${since} AND s."startedAt" < ${until} ${campaignFilter}
    `,
    prisma.$queryRaw<TrafficQualityArrival[]>`
      SELECT to_char(
               date_trunc('hour', "startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})
                 + (extract(minute FROM "startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::int / 10) * interval '10 min',
               'HH24:MI'
             ) AS bucket,
             count(*)::int AS sessions
        FROM "AnalyticsSession"
       WHERE "startedAt" >= ${since} AND "startedAt" < ${until} ${campaignFilter}
       GROUP BY 1
       ORDER BY 1
    `,
  ]);

  const { sessions, distinctVisitors } = overview[0] ?? { sessions: 0, distinctVisitors: 0 };
  const { total: silentTotal, withoutEvents } = silent[0] ?? { total: 0, withoutEvents: 0 };
  const { sessionsWithActivity, views, contacts } = funnel[0] ?? {
    sessionsWithActivity: 0,
    views: 0,
    contacts: 0,
  };

  return {
    date: query.date,
    utmCampaign: query.utmCampaign ?? null,
    sessions,
    distinctVisitors,
    sessionsPerVisitor: distinctVisitors > 0 ? sessions / distinctVisitors : null,
    topVisitors,
    sessionsWithoutEvents: withoutEvents,
    sessionsWithoutEventsPct: silentTotal > 0 ? (withoutEvents / silentTotal) * 100 : null,
    funnelSessionsWithActivity: sessionsWithActivity,
    funnelViews: views,
    funnelContacts: contacts,
    arrivals,
  };
}
