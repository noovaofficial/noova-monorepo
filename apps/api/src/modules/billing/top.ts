import { type BuyTopResult, TOP_WEEK_DAYS, type TopPlacement, type TopState } from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { applyMovement } from './wallet.js';

/**
 * ТОП (payments.md §3.4, D-10): ограниченное число мест, неделя за раз,
 * без листа ожидания и автопродления.
 *
 * Пока место активно, купить его снова нельзя (D-11): недели не
 * складываются, и место занимает ровно одну неделю. Купить заново можно
 * после истечения — тогда та же строка оживает с новым сроком.
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

export class TopAlreadyActiveError extends Error {
  constructor(readonly expiresAt: Date) {
    super('Анкета уже в ТОПе');
    this.name = 'TopAlreadyActiveError';
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
 * Покупка недели. Всё в одной транзакции под замком на строке настроек:
 * два человека, берущие последнее место одновременно, встанут в очередь,
 * и второму честно откажут, а не выдадут семнадцатое.
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
    // Недели не складываются (D-11): пока место активно, вторая покупка
    // отклоняется. Проверка на сервере, а не только в интерфейсе: кнопка
    // защищает от случайного нажатия, а не от повторного запроса.
    if (current !== null && current.status === 'active' && current.expiresAt > now) {
      throw new TopAlreadyActiveError(current.expiresAt);
    }

    const taken = await tx.topPlacement.count({ where: activeWhere(now) });
    if (taken >= purchase.slots) throw new TopFullError(purchase.slots);

    const spend = await applyMovement(tx, {
      userId: purchase.userId,
      kind: 'TOP',
      gcAmount: -purchase.priceGc,
    });

    // Срок всегда от сегодня: активного места здесь уже не бывает.
    const expiresAt = new Date(now.getTime() + WEEK_MS);
    const placement = current
      ? await tx.topPlacement.update({
          where: { profileId: profile.id },
          data: { userId: purchase.userId, status: 'active', startsAt: now, expiresAt },
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

/**
 * Срок места после выдачи админом. Место ещё действует — продлеваем от его
 * конца, а не от «сейчас»: иначе выданная неделя съела бы остаток оплаченного
 * срока. Места нет или оно истекло — обычные `now + срок`.
 */
export function expiryAfterGrant(
  current: { status: 'active' | 'expired'; expiresAt: Date } | null,
  now: Date,
  durationMs: number,
): { expiresAt: Date; extended: boolean } {
  const active = current !== null && current.status === 'active' && current.expiresAt > now;
  return {
    expiresAt: new Date((active ? current.expiresAt : now).getTime() + durationMs),
    extended: active,
  };
}

export type TopGrant = {
  profileId: string;
  slots: number;
  now?: Date;
  /** Кастомный срок в днях — только для ручной выдачи админом. Без него — неделя. */
  durationDays?: number;
};

/**
 * Выдача места админом (без оплаты) — то же место, тот же лимит и те же
 * проверки, что у покупки, только без списания GlowCoin: `applyMovement`
 * не вызывается. Если место уже действует, оно продлевается (`extended`). Место засчитывается на владельца анкеты, чтобы попасть в
 * его собственный `GET /billing/top` наравне с купленными.
 */
export function grantTop(
  prisma: PrismaClient,
  grant: TopGrant,
): Promise<{ placement: TopPlacement; extended: boolean }> {
  const now = grant.now ?? new Date();
  const durationMs = (grant.durationDays ?? TOP_WEEK_DAYS) * 24 * 60 * 60 * 1000;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BillingSettings" WHERE "id" = 'default' FOR UPDATE`;

    const profile = await tx.profile.findUnique({
      where: { id: grant.profileId },
      select: { id: true, ownerId: true, status: true, topPlacement: true },
    });
    if (!profile) throw new TopNotPublishedError();
    if (profile.status !== 'published') throw new TopNotPublishedError();

    const current = profile.topPlacement;
    const { expiresAt, extended } = expiryAfterGrant(current, now, durationMs);

    // Продление места, которое уже занято, свободного слота не требует.
    if (!extended) {
      const taken = await tx.topPlacement.count({ where: activeWhere(now) });
      if (taken >= grant.slots) throw new TopFullError(grant.slots);
    }

    const placement = current
      ? await tx.topPlacement.update({
          where: { profileId: profile.id },
          data: extended
            ? { userId: profile.ownerId, expiresAt }
            : { userId: profile.ownerId, status: 'active', startsAt: now, expiresAt },
        })
      : await tx.topPlacement.create({
          data: {
            profileId: profile.id,
            userId: profile.ownerId,
            status: 'active',
            startsAt: now,
            expiresAt,
          },
        });

    await tx.profile.update({ where: { id: profile.id }, data: { isFeatured: true } });

    return { placement: toTopPlacement(placement), extended };
  });
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
