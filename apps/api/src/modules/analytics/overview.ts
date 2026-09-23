import {
  type AdvertiserKind,
  ANALYTICS_PERIOD_DAYS,
  type Overview,
  type OverviewKindStats,
  type OverviewPeriod,
  type OverviewQuery,
  type OverviewRow,
} from '@noova/shared';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { berlinDate, shiftDate } from './query.js';

const TZ = 'Europe/Berlin';
const KINDS: AdvertiserKind[] = ['agency', 'individual', 'salon'];

/** Целое отношение в центах или `null`, если делить не на что. */
export function ratioCents(cents: number, divisor: number): number | null {
  return divisor > 0 ? Math.round(cents / divisor) : null;
}

/** Изменение к предыдущему периоду в процентах; `null`, если базы нет. */
export function changePct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

type UserMetrics = {
  userId: string;
  email: string;
  kind: AdvertiserKind;
  profiles: number;
  publishedProfiles: number;
  paidEurCents: number;
  topupCount: number;
  viewsReg: number;
  viewsAnon: number;
  clicksReg: number;
  clicksAnon: number;
  giftedGc: number;
};

const views = (m: UserMetrics) => m.viewsReg + m.viewsAnon;
const clicks = (m: UserMetrics) => m.clicksReg + m.clicksAnon;

/** Сводка по типам рекламодателя. Чистая функция: правила деления и долей
 *  проверяются тестом без базы. */
export function summarizeKinds(users: UserMetrics[]): OverviewKindStats[] {
  const totalPaid = users.reduce((sum, u) => sum + u.paidEurCents, 0);

  return KINDS.map((kind) => {
    const group = users.filter((u) => u.kind === kind);
    const paid = group.reduce((sum, u) => sum + u.paidEurCents, 0);
    const published = group.reduce((sum, u) => sum + u.publishedProfiles, 0);
    return {
      kind,
      advertisers: group.length,
      payingAdvertisers: group.filter((u) => u.paidEurCents > 0).length,
      profiles: group.reduce((sum, u) => sum + u.profiles, 0),
      publishedProfiles: published,
      paidEurCents: paid,
      sharePct: totalPaid > 0 ? Math.round((paid / totalPaid) * 1000) / 10 : 0,
      eurPerAdvertiserCents: ratioCents(paid, group.length),
      eurPerPublishedCents: ratioCents(paid, published),
      views: {
        registered: group.reduce((sum, u) => sum + u.viewsReg, 0),
        anonymous: group.reduce((sum, u) => sum + u.viewsAnon, 0),
      },
      contactClicks: {
        registered: group.reduce((sum, u) => sum + u.clicksReg, 0),
        anonymous: group.reduce((sum, u) => sum + u.clicksAnon, 0),
      },
    };
  });
}

function toRow(m: UserMetrics, name: string | null): OverviewRow {
  return {
    userId: m.userId,
    email: m.email,
    name,
    kind: m.kind,
    profiles: m.profiles,
    publishedProfiles: m.publishedProfiles,
    paidEurCents: m.paidEurCents,
    topupCount: m.topupCount,
    views: views(m),
    contactClicks: clicks(m),
    eurPerPublishedCents: ratioCents(m.paidEurCents, m.publishedProfiles),
    eurPerClickCents: ratioCents(m.paidEurCents, clicks(m)),
    giftedGc: m.giftedGc,
  };
}

const SORT_VALUE: Record<OverviewQuery['sort'], (m: UserMetrics) => number> = {
  paid: (m) => m.paidEurCents,
  profiles: (m) => m.profiles,
  views,
  clicks,
  // «Нет данных» (делить не на что) уходит вниз при любой сортировке.
  eurPerProfile: (m) => ratioCents(m.paidEurCents, m.publishedProfiles) ?? -1,
  eurPerClick: (m) => ratioCents(m.paidEurCents, clicks(m)) ?? -1,
};

/** Сортировка с однозначным порядком: одинаковые значения — по почте. */
export function sortUsers(users: UserMetrics[], sort: OverviewQuery['sort'], dir: 'asc' | 'desc') {
  const value = SORT_VALUE[sort];
  const sign = dir === 'asc' ? 1 : -1;
  return [...users].sort((a, b) => sign * (value(a) - value(b)) || a.email.localeCompare(b.email));
}

type Range = { from: string; to: string } | null;

function periodRange(period: OverviewPeriod, today: string): Range {
  if (period === 'all') return null;
  const days = ANALYTICS_PERIOD_DAYS[period];
  return { from: shiftDate(today, -(days - 1)), to: today };
}

/** Полночь берлинской даты в виде, в котором лежит `timestamp` без пояса. */
const berlinStart = (date: string) =>
  Prisma.sql`((${date}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;

/** Условие по `createdAt` для берлинских суток [from, to] включительно. */
function createdBetween(range: Range) {
  if (!range) return Prisma.sql`TRUE`;
  return Prisma.sql`"createdAt" >= ${berlinStart(range.from)} AND "createdAt" < ${berlinStart(shiftDate(range.to, 1))}`;
}

type PaidRow = { userId: string; paid: number; n: number };
type GiftRow = { userId: string; gc: number };
type ChartRow = { bucket: string; paid: number };
type EventRow = { ownerId: string; kind: string; registered: number; anonymous: number };
type ProfileRow = { ownerId: string; total: number; published: number };

async function load(prisma: PrismaClient, query: OverviewQuery, now: Date): Promise<Overview> {
  const today = berlinDate(now);
  const range = periodRange(query.period, today);
  const days = query.period === 'all' ? 0 : ANALYTICS_PERIOD_DAYS[query.period];
  const prevRange: Range =
    range && days > 0
      ? { from: shiftDate(range.from, -days), to: shiftDate(range.from, -1) }
      : null;

  const berlinDay = Prisma.sql`("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date`;
  const bucketFormat = query.period === 'all' ? 'YYYY-MM' : 'YYYY-MM-DD';

  const [paid, gifts, chartRows, prevPaid, events, profileCounts, users] = await Promise.all([
    prisma.$queryRaw<PaidRow[]>`
      SELECT "userId", sum("eurPaidCents")::int AS paid, count(*)::int AS n
        FROM "BillingTransaction"
       WHERE "kind" = 'TOPUP'::"BillingTransactionKind" AND "userId" IS NOT NULL
         AND ${createdBetween(range)}
       GROUP BY 1`,
    prisma.$queryRaw<GiftRow[]>`
      SELECT "userId", sum("gcAmount")::int AS gc
        FROM "BillingTransaction"
       WHERE "kind" = 'ADJUSTMENT'::"BillingTransactionKind" AND "gcAmount" > 0
         AND "userId" IS NOT NULL AND ${createdBetween(range)}
       GROUP BY 1`,
    prisma.$queryRaw<ChartRow[]>`
      SELECT to_char(${berlinDay}, ${bucketFormat}) AS bucket, sum("eurPaidCents")::int AS paid
        FROM "BillingTransaction"
       WHERE "kind" = 'TOPUP'::"BillingTransactionKind" AND ${createdBetween(range)}
       GROUP BY 1 ORDER BY 1`,
    prevRange
      ? prisma.$queryRaw<{ paid: number | null }[]>`
          SELECT sum("eurPaidCents")::int AS paid
            FROM "BillingTransaction"
           WHERE "kind" = 'TOPUP'::"BillingTransactionKind" AND ${createdBetween(prevRange)}`
      : Promise.resolve(null),
    // События — из суточных агрегатов (`ProfileEventDaily`), не из сырого журнала.
    prisma.$queryRaw<EventRow[]>`
      SELECT p."ownerId", d."kind"::text AS kind,
             sum(d."registered")::int AS registered, sum(d."anonymous")::int AS anonymous
        FROM "ProfileEventDaily" d
        JOIN "Profile" p ON p."id" = d."profileId"
       WHERE d."kind" IN ('view'::"ProfileEventKind", 'contact_click'::"ProfileEventKind")
         ${range ? Prisma.sql`AND d."day" >= ${range.from}::date AND d."day" <= ${range.to}::date` : Prisma.empty}
       GROUP BY 1, 2`,
    prisma.$queryRaw<ProfileRow[]>`
      SELECT "ownerId", count(*)::int AS total,
             count(*) FILTER (WHERE "status" = 'published')::int AS published
        FROM "Profile" GROUP BY 1`,
    prisma.user.findMany({
      where: { role: 'advertiser', advertiserKind: { not: null } },
      select: { id: true, email: true, advertiserKind: true },
    }),
  ]);

  const paidBy = new Map(paid.map((r) => [r.userId, r]));
  const giftBy = new Map(gifts.map((r) => [r.userId, r.gc]));
  const profilesBy = new Map(profileCounts.map((r) => [r.ownerId, r]));
  const eventsBy = new Map<string, Record<string, EventRow>>();
  for (const e of events) {
    eventsBy.set(e.ownerId, { ...(eventsBy.get(e.ownerId) ?? {}), [e.kind]: e });
  }

  const metrics: UserMetrics[] = users.map((u) => {
    const ev = eventsBy.get(u.id) ?? {};
    const profiles = profilesBy.get(u.id);
    return {
      userId: u.id,
      email: u.email,
      kind: u.advertiserKind as AdvertiserKind,
      profiles: profiles?.total ?? 0,
      publishedProfiles: profiles?.published ?? 0,
      paidEurCents: paidBy.get(u.id)?.paid ?? 0,
      topupCount: paidBy.get(u.id)?.n ?? 0,
      viewsReg: ev.view?.registered ?? 0,
      viewsAnon: ev.view?.anonymous ?? 0,
      clicksReg: ev.contact_click?.registered ?? 0,
      clicksAnon: ev.contact_click?.anonymous ?? 0,
      giftedGc: giftBy.get(u.id) ?? 0,
    };
  });

  const totalPaid = metrics.reduce((sum, m) => sum + m.paidEurCents, 0);
  const totalTopups = metrics.reduce((sum, m) => sum + m.topupCount, 0);
  const previous = prevPaid ? (prevPaid[0]?.paid ?? 0) : null;

  const filtered = query.kind ? metrics.filter((m) => m.kind === query.kind) : metrics;
  const sorted = sortUsers(filtered, query.sort, query.dir);
  const page = sorted.slice(query.offset, query.offset + query.limit);

  // Названия — только для строк страницы: компания у агентства, имя анкеты у остальных.
  const named = await prisma.user.findMany({
    where: { id: { in: page.map((m) => m.userId) } },
    select: {
      id: true,
      company: { select: { name: true } },
      profiles: { take: 1, orderBy: { createdAt: 'asc' }, select: { displayName: true } },
    },
  });
  const nameBy = new Map(
    named.map((u) => [u.id, u.company?.name ?? u.profiles[0]?.displayName ?? null]),
  );

  return {
    period: query.period,
    from: range?.from ?? null,
    to: today,
    totals: {
      paidEurCents: totalPaid,
      topupCount: totalTopups,
      payingAdvertisers: metrics.filter((m) => m.paidEurCents > 0).length,
      avgCheckCents: ratioCents(totalPaid, totalTopups),
      previousPaidEurCents: previous,
      changePct: previous === null ? null : changePct(totalPaid, previous),
    },
    byKind: summarizeKinds(metrics),
    chart: {
      bucket: query.period === 'all' ? 'month' : 'day',
      points: chartRows.map((r) => ({ date: r.bucket, paidEurCents: r.paid })),
    },
    rows: page.map((m) => toRow(m, nameBy.get(m.userId) ?? null)),
    total: filtered.length,
  };
}

/**
 * Обзор рекламодателей: деньги (только оплаченные €), анкеты и события по
 * типам и по каждому рекламодателю. Кэшируется на пять минут: смотрят его
 * единицы админов, а пересчёт по всем рекламодателям того не стоит.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Overview }>();

export async function loadOverview(
  prisma: PrismaClient,
  query: OverviewQuery,
  now: Date = new Date(),
): Promise<Overview> {
  const key = JSON.stringify(query);
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await load(prisma, query, now);
  cache.set(key, { at: now.getTime(), value });
  return value;
}

export const clearOverviewCache = () => cache.clear();
