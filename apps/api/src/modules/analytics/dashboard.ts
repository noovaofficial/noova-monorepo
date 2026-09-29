import {
  ANALYTICS_PERIOD_DAYS,
  type AnalyticsPeriod,
  type Dashboard,
  type DashboardCityRow,
  type DashboardSourceRow,
} from '@noova/shared';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { berlinDate, shiftDate } from './query.js';

const TZ = 'Europe/Berlin';

/** Местная полночь дня в виде, в котором лежит `timestamp` без пояса —
 *  тот же приём, что и в `query.ts`/`overview.ts`. */
const berlinStart = (date: string) =>
  Prisma.sql`((${date}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;

// --- Источники -------------------------------------------------------------

type SourceRow = {
  source: string;
  network: string;
  utmCampaign: string;
  sessions: number;
  botSessions: number;
  contacts: number;
};

async function loadSources(
  prisma: PrismaClient,
  from: string,
  to: string,
): Promise<Dashboard['sources']> {
  const rows = await prisma.$queryRaw<SourceRow[]>`
    SELECT "source", "network", "utmCampaign",
           sum("sessions")::int AS sessions,
           sum("botSessions")::int AS "botSessions",
           sum("contacts")::int AS contacts
      FROM "SourceDailyStat"
     WHERE "day" >= ${from}::date AND "day" <= ${to}::date
     GROUP BY 1, 2, 3
     ORDER BY 6 DESC
  `;

  const dashboardRows: DashboardSourceRow[] = rows.map((row) => ({
    ...row,
    // До фазы 7 (интеграции с сетями) таблицы расходов нет — см. схему.
    costPerContactEurCents: null,
  }));

  return {
    rows: dashboardRows,
    totals: rows.reduce(
      (acc, row) => ({
        sessions: acc.sessions + row.sessions,
        botSessions: acc.botSessions + row.botSessions,
        contacts: acc.contacts + row.contacts,
      }),
      { sessions: 0, botSessions: 0, contacts: 0 },
    ),
  };
}

// --- Города ------------------------------------------------------------

type CityTrafficRow = {
  city: string;
  category: string;
  sessions: number;
  profileViews: number;
  contacts: number;
};

type CitySnapshotRow = { city: string; category: string; activeProfiles: number };

/** Сколько активных анкет считаем «дефицитом» — ниже этого порога город
 *  попадает в кандидаты на «высокий спрос, мало предложения». Число не
 *  из статистики, а решение продукта: три анкеты на город — это явно
 *  тесно, но подобрано на глаз и заслуживает пересмотра по реальным данным. */
const LOW_SUPPLY_THRESHOLD = 3;

/**
 * «Высокий спрос, мало анкет» (фаза 6). Два случая:
 *
 * 1. Анкет нет вовсе, но был трафик или контакты — самый явный сигнал:
 *    город кто-то искал, продавать там некому.
 * 2. Анкет мало (`<= LOW_SUPPLY_THRESHOLD`), и контактов на анкету не
 *    меньше, чем в среднем по всем городам с анкетами — то есть спрос
 *    на одну анкету здесь не ниже обычного, несмотря на дефицит выбора;
 *    больше анкет эту нишу, скорее всего, не разбавит, а раскроет.
 *
 * Чистая функция — эвристика проверяется тестом без базы.
 */
export function flagHighDemand(
  row: {
    activeProfiles: number;
    contactsPerProfile: number | null;
    sessions: number;
    contacts: number;
  },
  avgContactsPerProfile: number,
): boolean {
  if (row.activeProfiles === 0) return row.sessions > 0 || row.contacts > 0;
  if (row.activeProfiles > LOW_SUPPLY_THRESHOLD) return false;
  return (row.contactsPerProfile ?? 0) >= avgContactsPerProfile;
}

async function loadCities(
  prisma: PrismaClient,
  from: string,
  to: string,
): Promise<Dashboard['cities']> {
  const [traffic, snapshot] = await Promise.all([
    prisma.$queryRaw<CityTrafficRow[]>`
      SELECT "city", "category",
             sum("sessions")::int AS sessions,
             sum("profileViews")::int AS "profileViews",
             sum("contacts")::int AS contacts
        FROM "CityDailyStat"
       WHERE "day" >= ${from}::date AND "day" <= ${to}::date
       GROUP BY 1, 2
    `,
    /**
     * Снимок активных анкет — самый свежий день на момент `to` или раньше,
     * а НЕ сумма по диапазону: `activeProfiles` в каждой строке дня — это
     * состояние на момент пересчёта, одно и то же число повторяется во
     * все дни окна (см. `rollupActiveProfiles`). Сложить их за 30 дней
     * значило бы получить снимок, умноженный на 30.
     */
    prisma.$queryRaw<CitySnapshotRow[]>`
      SELECT DISTINCT ON ("city", "category") "city", "category", "activeProfiles"
        FROM "CityDailyStat"
       WHERE "day" <= ${to}::date
       ORDER BY "city", "category", "day" DESC
    `,
  ]);

  const snapshotByKey = new Map(
    snapshot.map((row) => [`${row.city}\u0000${row.category}`, row.activeProfiles]),
  );
  const trafficByKey = new Map(traffic.map((row) => [`${row.city}\u0000${row.category}`, row]));

  // Объединение ключей: город может иметь снимок анкет без трафика в окне
  // (никто не заходил) или трафик без текущих анкет (все сняты с публикации).
  const keys = new Set([...snapshotByKey.keys(), ...trafficByKey.keys()]);

  const merged = [...keys].map((key) => {
    const [city, category] = key.split('\u0000') as [string, string];
    const t = trafficByKey.get(key);
    const activeProfiles = snapshotByKey.get(key) ?? 0;
    const contacts = t?.contacts ?? 0;
    const contactsPerProfile = activeProfiles > 0 ? contacts / activeProfiles : null;
    return {
      city,
      category,
      sessions: t?.sessions ?? 0,
      profileViews: t?.profileViews ?? 0,
      contacts,
      activeProfiles,
      contactsPerProfile,
    };
  });

  const withProfiles = merged.filter((row) => row.activeProfiles > 0);
  const avgContactsPerProfile = withProfiles.length
    ? withProfiles.reduce((sum, row) => sum + (row.contactsPerProfile ?? 0), 0) /
      withProfiles.length
    : 0;

  const rows: DashboardCityRow[] = merged
    .map((row) => ({ ...row, highDemand: flagHighDemand(row, avgContactsPerProfile) }))
    // Заметнее сверху — спрос без выбора важнее ровного трафика; внутри
    // групп сортировка по контактам, чтобы список вообще был читаемым.
    .sort((a, b) => Number(b.highDemand) - Number(a.highDemand) || b.contacts - a.contacts);

  return { rows };
}

// --- Выручка -----------------------------------------------------------

type RevenueRow = { day: string; topup: number | null; listing: number | null; top: number | null };

async function loadRevenue(
  prisma: PrismaClient,
  from: string,
  to: string,
): Promise<Dashboard['revenue']> {
  const since = berlinStart(from);
  const until = berlinStart(shiftDate(to, 1));
  const berlinDay = Prisma.sql`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date`;

  const rows = await prisma.$queryRaw<RevenueRow[]>`
    SELECT to_char(${berlinDay}, 'YYYY-MM-DD') AS day,
           sum("eurPaidCents") FILTER (WHERE "kind" = 'TOPUP'::"BillingTransactionKind")::int AS topup,
           sum(abs("gcAmount")) FILTER (WHERE "kind" = 'SPEND'::"BillingTransactionKind")::int AS listing,
           sum(abs("gcAmount")) FILTER (WHERE "kind" = 'TOP'::"BillingTransactionKind")::int AS top
      FROM "BillingTransaction"
     WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
     GROUP BY 1
     ORDER BY 1
  `;

  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series = [];
  for (let day = from; day <= to; day = shiftDate(day, 1)) {
    const row = byDay.get(day);
    series.push({
      date: day,
      topupEurCents: row?.topup ?? 0,
      spentListingGc: row?.listing ?? 0,
      spentTopGc: row?.top ?? 0,
    });
  }

  return {
    series,
    totals: series.reduce(
      (acc, point) => ({
        topupEurCents: acc.topupEurCents + point.topupEurCents,
        spentListingGc: acc.spentListingGc + point.spentListingGc,
        spentTopGc: acc.spentTopGc + point.spentTopGc,
      }),
      { topupEurCents: 0, spentListingGc: 0, spentTopGc: 0 },
    ),
  };
}

/**
 * Внутренний дашборд целиком: источники, спрос по городам, выручка.
 * Все три читают только роллапы (`SourceDailyStat`, `CityDailyStat`) и
 * `BillingTransaction` за диапазон дней — ни один не сканирует сырой
 * `ProfileEvent`, отсюда и требование «меньше секунды на 90 днях».
 */
export async function loadDashboard(
  prisma: PrismaClient,
  period: AnalyticsPeriod,
  now: Date = new Date(),
): Promise<Dashboard> {
  const to = berlinDate(now);
  const from = shiftDate(to, -(ANALYTICS_PERIOD_DAYS[period] - 1));

  const [sources, cities, revenue] = await Promise.all([
    loadSources(prisma, from, to),
    loadCities(prisma, from, to),
    loadRevenue(prisma, from, to),
  ]);

  return { period, from, to, sources, cities, revenue };
}
