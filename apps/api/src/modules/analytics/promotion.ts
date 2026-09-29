import { type AnalyticsPromotionEffect, CONTACT_EVENT_KINDS } from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AnalyticsScope } from './query.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько суток до начала ТОПа берём для сравнения «было». Фиксировано,
 *  не зависит от выбранного в кабинете периода отчёта — вопрос один и тот
 *  же независимо от того, 7, 30 или 90 дней сейчас выбрано сверху. */
const BEFORE_WINDOW_DAYS = 14;

/** Не показываем эффект размещения старше этого срока: `TopPlacement`
 *  держит только последнее размещение анкеты (одна строка на профиль,
 *  переиспользуется при повторной покупке — D-11), и без отсечки кабинет
 *  годами показывал бы эффект давно прошедшего ТОПа, как будто это
 *  свежая новость. 90 дней — самый долгий период, который вообще можно
 *  выбрать в отчёте; эффект вне него сравнивать уже не с чем на экране. */
const STALE_AFTER_DAYS = 90;

/** Минимум суток в знаменателе «контактов в день»: ТОП, купленный минуту
 *  назад, не должен давать нестабильное число вроде «120 контактов в
 *  день» из-за одного случайного клика в первую минуту. */
const MIN_DURATION_DAYS = 1;

async function countContacts(
  prisma: PrismaClient,
  profileId: string,
  ownerId: string,
  since: Date,
  until: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM "ProfileEvent"
     WHERE "profileId" = ${profileId}
       AND "kind" = ANY(${CONTACT_EVENT_KINDS}::"ProfileEventKind"[])
       AND "createdAt" >= ${since}
       AND "createdAt" < ${until}
       AND "isBot" = FALSE
       AND ("userId" IS NULL OR "userId" <> ${ownerId})
  `;
  return rows[0]?.n ?? 0;
}

/**
 * Эффект ТОПа: контакты в день во время последнего размещения анкеты
 * против 14 дней до его начала. Только для анкет, у которых размещение
 * вообще было и не устарело больше `STALE_AFTER_DAYS` дней назад.
 *
 * Период отчёта (`AnalyticsPeriod`) здесь не участвует: окно вопроса — сама
 * длительность ТОПа плюс 14 дней до него, а не то, что выбрано сверху в
 * переключателе кабинета.
 */
export async function loadPromotionEffects(
  prisma: PrismaClient,
  { profiles, ownerId }: AnalyticsScope,
  now: Date = new Date(),
): Promise<AnalyticsPromotionEffect[]> {
  if (profiles.length === 0) return [];

  const staleBefore = new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS);
  const placements = await prisma.topPlacement.findMany({
    where: {
      profileId: { in: profiles.map((profile) => profile.id) },
      expiresAt: { gte: staleBefore },
    },
    select: { profileId: true, startsAt: true, expiresAt: true },
  });
  if (placements.length === 0) return [];

  const byProfile = new Map(profiles.map((profile) => [profile.id, profile]));

  const rows = await Promise.all(
    placements.map(async (placement) => {
      const profile = byProfile.get(placement.profileId);
      if (!profile) return null;

      const duringStart = placement.startsAt;
      const duringEnd = placement.expiresAt < now ? placement.expiresAt : now;
      const beforeEnd = placement.startsAt;
      const beforeStart = new Date(beforeEnd.getTime() - BEFORE_WINDOW_DAYS * DAY_MS);

      const durationDuring = Math.max(
        (duringEnd.getTime() - duringStart.getTime()) / DAY_MS,
        MIN_DURATION_DAYS,
      );

      const [duringCount, beforeCount] = await Promise.all([
        countContacts(prisma, profile.id, ownerId, duringStart, duringEnd),
        countContacts(prisma, profile.id, ownerId, beforeStart, beforeEnd),
      ]);

      const effect: AnalyticsPromotionEffect = {
        profileId: profile.id,
        displayName: profile.displayName,
        slug: profile.slug,
        startsAt: placement.startsAt.toISOString(),
        expiresAt: placement.expiresAt.toISOString(),
        contactsPerDayDuring: duringCount / durationDuring,
        contactsPerDayBefore: beforeCount / BEFORE_WINDOW_DAYS,
      };
      return effect;
    }),
  );

  return rows.filter((row): row is AnalyticsPromotionEffect => row !== null);
}
