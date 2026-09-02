import {
  ANALYTICS_PERIOD_DAYS,
  type Analytics,
  type AnalyticsPeriod,
  type AnalyticsPoint,
  type AnalyticsSplit,
  CONTACT_TYPES,
  type ContactType,
} from '@noova/shared';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { ProfileEventKind } from '../../generated/prisma/enums.js';

/**
 * Сутки считаются по Берлину, а не по UTC. Рынок один, и «вчера» у владелицы
 * начинается в её полночь: по UTC пик вечерних заходов уезжал бы в следующий
 * день, и график показывал бы всплеск на сутки позже, чем он был.
 */
const TZ = 'Europe/Berlin';

/** Календарная дата в Берлине, YYYY-MM-DD. `en-CA` даёт ровно этот порядок. */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function berlinDate(at: Date): string {
  return dateFormatter.format(at);
}

/**
 * Сдвиг календарной даты на n суток. Считаем по строке через UTC-полночь,
 * а не арифметикой над моментом времени: перевод часов сделал бы «минус
 * сутки» то 23, то 25 часами, и ряд в марте потерял бы день.
 */
function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Все даты периода подряд, включая пустые. Дыра в ряду читалась бы как
 *  «данных нет», а не как «в этот день не заходили». */
function dateRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDate(day, 1)) days.push(day);
  return days;
}

const KIND_TO_METRIC = {
  view: 'views',
  favorite: 'favorites',
  contact_reveal: 'contactReveals',
  contact_click: 'contactClicks',
} as const satisfies Record<ProfileEventKind, keyof AnalyticsPoint>;

const emptySplit = (): AnalyticsSplit => ({ total: 0, registered: 0, anonymous: 0 });

type Bucket = { day: string; kind: ProfileEventKind; registered: boolean; n: number };
type ProfileBucket = { profileId: string; kind: ProfileEventKind; n: number };
type ContactBucket = { contactType: ContactType | null; n: number };

export type AnalyticsScope = {
  /** Анкеты, по которым собираем. Пустой список — у рекламодателя ещё нет анкет. */
  profiles: { id: string; displayName: string; slug: string }[];
  /** Владелец. Его собственные обращения из статистики исключаются. */
  ownerId: string;
};

/**
 * Статистика анкет рекламодателя за период.
 *
 * Три запроса вместо одного: разрезы разные (дни × вид × вошёл ли,
 * анкеты × вид, каналы связи), и вытащить их одной группировкой можно
 * только через `GROUPING SETS` — запрос, который потом никто не прочитает.
 * Все три идут по одному индексу `(profileId, kind, createdAt)` и по одному
 * и тому же узкому срезу строк.
 */
export async function loadAnalytics(
  prisma: PrismaClient,
  { profiles, ownerId }: AnalyticsScope,
  period: AnalyticsPeriod,
  now: Date = new Date(),
): Promise<Analytics> {
  const days = ANALYTICS_PERIOD_DAYS[period];
  const to = berlinDate(now);
  const from = shiftDate(to, -(days - 1));

  const empty: Analytics = {
    period,
    from,
    to,
    totals: {
      views: emptySplit(),
      favorites: emptySplit(),
      contactReveals: emptySplit(),
      contactClicks: emptySplit(),
    },
    series: dateRange(from, to).map((date) => ({
      date,
      views: 0,
      favorites: 0,
      contactReveals: 0,
      contactClicks: 0,
    })),
    contacts: CONTACT_TYPES.map((type) => ({ type, clicks: 0 })),
    profiles: [],
  };

  // Ни одной анкеты — считать нечего, а `IN ()` в запросе ещё и не соберётся.
  if (profiles.length === 0) return empty;

  const ids = profiles.map((profile) => profile.id);

  /**
   * Prisma кладёт `DateTime` в `timestamp` **без** часового пояса, храня там
   * UTC. Postgres об этом не знает: для него это голое время без привязки,
   * и одиночное `AT TIME ZONE 'Europe/Berlin'` не переводит его в Берлин, а
   * объявляет берлинским — то есть сдвигает в другую сторону. Событие в
   * 22:40 UTC, то есть 00:40 следующего дня по Берлину, попадало из-за этого
   * во вчерашний столбик.
   *
   * Отсюда два шага: сперва объявить время тем, чем оно и является (UTC),
   * и только потом перевести в Берлин.
   */
  const berlinDay = Prisma.sql`("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date`;

  /**
   * Граница периода — местная полночь первого дня, а не полночь UTC: вторая
   * приходится на вечер предыдущего дня по Берлину, и в отчёт попадал бы
   * лишний кусок вечера. Считает Postgres — таблица переходов на летнее
   * время у него уже есть, и дублировать её в JS незачем. Последнее
   * `AT TIME ZONE 'UTC'` возвращает результат в тот же вид без пояса, в
   * котором лежит сама колонка: иначе сравнение приводило бы типы по
   * часовому поясу сессии, а он у нас ничем не задан.
   */
  const since = Prisma.sql`((${from}::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;

  /**
   * Собственные обращения владельца из отчёта исключаются: он открывает свою
   * анкету чаще любого посетителя — посмотреть, как она выглядит, — и без
   * этого условия проверял бы по графику сам себя. Гости (`userId IS NULL`)
   * остаются: среди них его не отличить, да и не нужно.
   */
  const [buckets, byProfile, byContact] = await Promise.all([
    prisma.$queryRaw<Bucket[]>`
      SELECT to_char(${berlinDay}, 'YYYY-MM-DD') AS day,
             "kind",
             ("userId" IS NOT NULL) AS registered,
             count(*)::int AS n
        FROM "ProfileEvent"
       WHERE "profileId" = ANY(${ids})
         AND "createdAt" >= ${since}
         AND ("userId" IS NULL OR "userId" <> ${ownerId})
       GROUP BY 1, 2, 3
    `,
    prisma.$queryRaw<ProfileBucket[]>`
      SELECT "profileId", "kind", count(*)::int AS n
        FROM "ProfileEvent"
       WHERE "profileId" = ANY(${ids})
         AND "createdAt" >= ${since}
         AND ("userId" IS NULL OR "userId" <> ${ownerId})
       GROUP BY 1, 2
    `,
    prisma.$queryRaw<ContactBucket[]>`
      SELECT "contactType", count(*)::int AS n
        FROM "ProfileEvent"
       WHERE "profileId" = ANY(${ids})
         AND "kind" = 'contact_click'::"ProfileEventKind"
         AND "createdAt" >= ${since}
         AND ("userId" IS NULL OR "userId" <> ${ownerId})
       GROUP BY 1
    `,
  ]);

  const result = empty;
  const pointByDate = new Map<string, AnalyticsPoint>(
    result.series.map((point) => [point.date, point]),
  );

  for (const bucket of buckets) {
    const metric = KIND_TO_METRIC[bucket.kind];
    const split = result.totals[metric];
    split.total += bucket.n;
    if (bucket.registered) split.registered += bucket.n;
    else split.anonymous += bucket.n;

    // День вне ряда возможен только на границе периода при смене суток
    // между расчётом границы и запросом — в итоги он входит, в график нет.
    const point = pointByDate.get(bucket.day);
    if (point) point[metric] += bucket.n;
  }

  const clicksByType = new Map(byContact.map((row) => [row.contactType, row.n]));
  result.contacts = CONTACT_TYPES.map((type) => ({ type, clicks: clicksByType.get(type) ?? 0 }));

  /**
   * Разбивка по анкетам — только когда их больше одной. У индивидуалки
   * и салона анкета единственная (PROFILE_LIMIT_BY_ADVERTISER), и таблица
   * из одной строки просто повторяла бы карточки итогов.
   */
  if (profiles.length > 1) {
    const counts = new Map<string, ProfileBucket[]>();
    for (const row of byProfile) {
      const list = counts.get(row.profileId);
      if (list) list.push(row);
      else counts.set(row.profileId, [row]);
    }

    result.profiles = profiles.map((profile) => {
      const row = {
        profileId: profile.id,
        displayName: profile.displayName,
        slug: profile.slug,
        views: 0,
        favorites: 0,
        contactReveals: 0,
        contactClicks: 0,
      };
      for (const bucket of counts.get(profile.id) ?? []) {
        row[KIND_TO_METRIC[bucket.kind]] += bucket.n;
      }
      return row;
    });
    // Самая заметная анкета сверху: список читают, чтобы найти отстающую,
    // и порядок «как заведены» этому не помогает.
    result.profiles.sort((a, b) => b.views - a.views);
  }

  return result;
}
