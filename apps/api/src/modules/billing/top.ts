import { type BuyTopResult, TOP_WEEK_DAYS, type TopPlacement, type TopState } from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { applyMovement } from './wallet.js';

/**
 * ТОП (payments.md §3.4, D-10): ограниченное число мест, неделя за раз,
 * без листа ожидания и автопродления. Место — одна строка на анкету:
 * продление сдвигает срок, повторная покупка после истечения оживляет её.
 *
 * `Profile.isFeatured` — производная: ставится здесь, снимается задачей.
 * По ней работают сортировка каталога и фильтр «ТОП», без джойна.
 */

const WEEK_MS = TOP_WEEK_DAYS * 24 * 60 * 60 * 1000;

export class TopFullError extends Error {
  constructor(readonly slots: number) {
    super('Все места в ТОПе заняты');
    this.name = 'TopFullError';
  }
}

export class TopNotPublishedError extends Error {
  constructor() {
    super('В ТОП можно поднять только опубликованную анкету');
    this.name = 'TopNotPublishedError';
  }
}

type PlacementRow = {
  profileId: string;
  status: 'active' | 'expired';
  startsAt: Date;
  expiresAt: Date;
};

export function toTopPlacement(row: PlacementRow): TopPlacement {
  return {
    profileId: row.profileId,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Занятые места — активные и ещё не истёкшие: задача снимает их с опозданием до цикла. */
const activeWhere = (now: Date) => ({ status: 'active' as const, expiresAt: { gt: now } });

export async function topState(
  prisma: PrismaClient,
  userId: string,
  config: { weekGc: number; slots: number },
  now: Date = new Date(),
): Promise<TopState> {
  const [taken, placements] = await Promise.all([
    prisma.topPlacement.count({ where: activeWhere(now) }),
    prisma.topPlacement.findMany({
      where: { userId, ...activeWhere(now) },
      orderBy: { expiresAt: 'asc' },
    }),
  ]);
  return {
    priceGc: config.weekGc,
    slots: config.slots,
    freeSlots: Math.max(0, config.slots - taken),
    placements: placements.map(toTopPlacement),
  };
}

export type TopPurchase = {
  userId: string;
  profileId: string;
  priceGc: number;
  slots: number;
  now?: Date;
};

/**
 * Покупка или продление. Всё в одной транзакции под замком на строке
 * настроек: два человека, берущие последнее место одновременно, встанут в
 * очередь, и второму честно откажут, а не выдадут семнадцатое.
 */
export function buyTop(prisma: PrismaClient, purchase: TopPurchase): Promise<BuyTopResult> {
  const now = purchase.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // Глобальный замок на покупку мест: строка настроек одна, и ждать её
    // секунду дешевле, чем разбирать лишнее место в ТОПе.
    await tx.$queryRaw`SELECT "id" FROM "BillingSettings" WHERE "id" = 'default' FOR UPDATE`;

    const profile = await tx.profile.findFirst({
      where: { id: purchase.profileId, ownerId: purchase.userId },
      select: { id: true, status: true, topPlacement: true },
    });
    if (!profile) throw new TopNotPublishedError();
    if (profile.status !== 'published') throw new TopNotPublishedError();

    const current = profile.topPlacement;
    const isActive = current !== null && current.status === 'active' && current.expiresAt > now;

    // Продление места не занимает: считаем только чужие активные.
    if (!isActive) {
      const taken = await tx.topPlacement.count({ where: activeWhere(now) });
      if (taken >= purchase.slots) throw new TopFullError(purchase.slots);
    }

    const spend = await applyMovement(tx, {
      userId: purchase.userId,
      kind: 'TOP',
      gcAmount: -purchase.priceGc,
    });

    const expiresAt = new Date((isActive ? current.expiresAt.getTime() : now.getTime()) + WEEK_MS);
    const placement = current
      ? await tx.topPlacement.update({
          where: { profileId: profile.id },
          data: {
            userId: purchase.userId,
            status: 'active',
            expiresAt,
            ...(isActive ? {} : { startsAt: now }),
          },
        })
      : await tx.topPlacement.create({
          data: {
            profileId: profile.id,
            userId: purchase.userId,
            status: 'active',
            startsAt: now,
            expiresAt,
          },
        });

    await tx.profile.update({ where: { id: profile.id }, data: { isFeatured: true } });

    return { placement: toTopPlacement(placement), ...spend };
  });
}

/**
 * Задача цикла: истёкшие места освобождаются, флаг с анкет снимается.
 * Возвращает число снятых. Кэш витрины — по слугам, как у истечения
 * размещений.
 */
export async function expireTopPlacements(
  prisma: PrismaClient,
  options: { now?: Date; revalidate?: (tags: string[]) => void } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const expired = await prisma.topPlacement.findMany({
    where: { status: 'active', expiresAt: { lte: now } },
    select: { id: true, profileId: true, profile: { select: { slug: true } } },
  });
  if (expired.length === 0) return 0;

  await prisma.$transaction([
    prisma.topPlacement.updateMany({
      where: { id: { in: expired.map((row) => row.id) } },
      data: { status: 'expired' },
    }),
    prisma.profile.updateMany({
      where: { id: { in: expired.map((row) => row.profileId) } },
      data: { isFeatured: false },
    }),
  ]);

  options.revalidate?.([PROFILES_TAG, ...expired.map((row) => profileTag(row.profile.slug))]);
  return expired.length;
}

/** Случайный порядок: каждая из анкет в ТОПе должна показываться одинаково часто. */
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}
