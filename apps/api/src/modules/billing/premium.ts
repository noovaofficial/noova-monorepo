import type { AdvertiserKind } from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { hasVisibleListing } from './listing.js';
import { placementFor } from './placement.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Premium-буст: подписка в месте с бесплатным размещением. Там подписка не
 * нужна для публикации, поэтому она — необязательный буст (значок и приоритет
 * в выдаче). В платном месте подписка есть у всех и ничем не выделяет.
 *
 * Флаг денормализован ради сортировки (как `isFeatured`) и пересчитывается
 * при каждом событии, которое его меняет: покупка и истечение подписки,
 * смена правил размещения, создание анкеты и смена её города.
 */

/** Чистое правило: буст есть, если подписка видна, место бесплатное и разрешено. */
export function isPremiumFor(input: {
  hasListing: boolean;
  placement: { paid: boolean; allowed: boolean } | null;
}): boolean {
  return (
    input.hasListing && input.placement !== null && !input.placement.paid && input.placement.allowed
  );
}

/** Пересчитывает флаг у всех анкет владельца. */
export async function syncPremiumForOwner(db: Db, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { advertiserKind: true },
  });
  const kind: AdvertiserKind | null = user?.advertiserKind ?? null;
  const hasListing = kind ? await hasVisibleListing(db, userId) : false;
  // Подписка есть — льготный срок после «стало платным» больше не нужен.
  if (hasListing) {
    await db.user.updateMany({
      where: { id: userId, placementGraceEndsAt: { not: null } },
      data: { placementGraceEndsAt: null },
    });
  }

  const profiles = await db.profile.findMany({
    where: { ownerId: userId },
    select: { id: true, cityId: true, countryId: true, isPremium: true },
  });

  // Правило зависит только от страны — считаем по одному разу на страну.
  const byCountry = new Map<string, boolean>();
  for (const profile of profiles) {
    if (!byCountry.has(profile.countryId)) {
      const placement = kind ? await placementFor(db, profile, kind) : null;
      byCountry.set(profile.countryId, isPremiumFor({ hasListing, placement }));
    }
  }

  const premiumIds: string[] = [];
  const plainIds: string[] = [];
  for (const profile of profiles) {
    const next = byCountry.get(profile.countryId) ?? false;
    if (next !== profile.isPremium) (next ? premiumIds : plainIds).push(profile.id);
  }
  if (premiumIds.length > 0) {
    await db.profile.updateMany({ where: { id: { in: premiumIds } }, data: { isPremium: true } });
  }
  if (plainIds.length > 0) {
    await db.profile.updateMany({ where: { id: { in: plainIds } }, data: { isPremium: false } });
  }
}

/** Пересчёт после смены правила размещения: все владельцы этого типа в стране. */
export async function syncPremiumForPlace(
  db: Db,
  place: { countryId?: string; cityId?: string },
  kind: AdvertiserKind,
): Promise<void> {
  const owners = await db.user.findMany({
    where: {
      advertiserKind: kind,
      profiles: {
        some: place.countryId ? { countryId: place.countryId } : { cityId: place.cityId },
      },
    },
    select: { id: true },
  });
  for (const owner of owners) await syncPremiumForOwner(db, owner.id);
}
