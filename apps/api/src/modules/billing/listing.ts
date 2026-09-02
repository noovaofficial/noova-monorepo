import {
  type ActivateListingResult,
  type PlanKind,
  type PlanTerm,
  TERM_MONTHS,
} from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { applyMovement, toListing } from './wallet.js';

/**
 * Активация размещения и его истечение (payments.md §4, этапы 3 и 5).
 *
 * Списание и листинг — в одной транзакции: списать и не выдать размещение
 * (или наоборот) значит спор, который нечем разобрать. Цена приходит из
 * прайса на сервере, никогда из запроса. Автопродления нет (D-09): срок
 * вышел — льготные дни — снятие с публикации; вернуться можно только оплатив.
 */

/**
 * Плюс N месяцев с зажимом дня: 31 января + месяц — это 28 февраля, а не
 * 3 марта, как сделал бы `setMonth`. Иначе срок «до конца месяца» тихо
 * съедал бы у человека несколько оплаченных дней.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Размещение, которое ещё держит анкеты в выдаче: активное или в льготных днях (D-04). */
export const VISIBLE_LISTING_STATUSES = ['active', 'grace'] as const;

export async function hasVisibleListing(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const count = await db.listing.count({
    where: { userId, status: { in: [...VISIBLE_LISTING_STATUSES] } },
  });
  return count > 0;
}

export type Activation = {
  userId: string;
  kind: PlanKind;
  term: PlanTerm;
  /** Цена из прайса — считает вызывающий, здесь только списание. */
  priceGc: number;
  now?: Date;
};

/**
 * Продление считается от конца текущего срока, а не от сегодня: оплатив
 * за неделю до истечения, человек не должен терять эту неделю. Истёкшее
 * размещение стартует заново от сегодня.
 */
export function nextExpiry(
  current: { status: string; expiresAt: Date } | null,
  term: PlanTerm,
  now: Date,
): Date {
  const from =
    current && current.status === 'active' && current.expiresAt > now ? current.expiresAt : now;
  return addMonths(from, TERM_MONTHS[term]);
}

export type ActivationOutcome = {
  result: ActivateListingResult;
  /** Анкеты, вернувшиеся в каталог после неоплаты, — вызывающему для сброса кэша. */
  restoredSlugs: string[];
};

export function activateListing(
  prisma: PrismaClient,
  activation: Activation,
): Promise<ActivationOutcome> {
  const now = activation.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // Списание первым: оно и держит замок на строке пользователя, так что
    // два параллельных нажатия «Активировать» встанут в очередь.
    const spend = await applyMovement(tx, {
      userId: activation.userId,
      kind: 'SPEND',
      gcAmount: -activation.priceGc,
    });

    const current = await tx.listing.findFirst({
      where: { userId: activation.userId },
      orderBy: { createdAt: 'desc' },
    });
    const expiresAt = nextExpiry(current, activation.term, now);

    const listing = current
      ? await tx.listing.update({
          where: { id: current.id },
          data: {
            kind: activation.kind,
            term: activation.term,
            status: 'active',
            expiresAt,
            // Дата активации сдвигается только при рестарте: у продления
            // размещение не прерывалось, и «активно с» остаётся прежним.
            ...(current.status === 'active' ? {} : { activatedAt: now }),
          },
        })
      : await tx.listing.create({
          data: {
            userId: activation.userId,
            kind: activation.kind,
            term: activation.term,
            status: 'active',
            activatedAt: now,
            expiresAt,
          },
        });

    // Анкеты, снятые за неоплату, возвращаются сами: человек заплатил ровно
    // за это. Снятые владельцем руками (`unpaidAt` пуст) остаются как были.
    const unpaid = await tx.profile.findMany({
      where: { ownerId: activation.userId, unpaidAt: { not: null } },
      select: { id: true, slug: true },
    });
    if (unpaid.length > 0) {
      await tx.profile.updateMany({
        where: { id: { in: unpaid.map((profile) => profile.id) } },
        data: { status: 'published', unpaidAt: null },
      });
    }

    return {
      result: { listing: toListing(listing), ...spend },
      restoredSlugs: unpaid.map((profile) => profile.slug),
    };
  });
}

/**
 * Что происходит с размещением в этот момент. Чистая функция — правило
 * льготных дней проверяется без базы.
 */
export function listingTransition(
  listing: { status: string; expiresAt: Date },
  graceDays: number,
  now: Date,
): 'grace' | 'expired' | null {
  if (listing.status === 'active' && listing.expiresAt <= now) {
    return graceDays > 0 ? 'grace' : 'expired';
  }
  if (
    listing.status === 'grace' &&
    listing.expiresAt.getTime() + graceDays * DAY_MS <= now.getTime()
  ) {
    return 'expired';
  }
  return null;
}

/**
 * Задача цикла (jobs/tasks.ts). Возвращает число размещений, сменивших
 * состояние. Истечение снимает опубликованные анкеты владельца с
 * публикации с пометкой `unpaidAt` — по ней активация вернёт их обратно.
 *
 * Кэш витрины здесь не сбрасывается: у процесса задач нет доступа к
 * фронту, и снятая анкета исчезает из каталога по истечении ISR.
 */
export async function expireListings(
  prisma: PrismaClient,
  graceDays: number,
  now: Date = new Date(),
): Promise<number> {
  const candidates = await prisma.listing.findMany({
    where: {
      OR: [
        { status: 'active', expiresAt: { lte: now } },
        { status: 'grace', expiresAt: { lte: new Date(now.getTime() - graceDays * DAY_MS) } },
      ],
    },
    select: { id: true, userId: true, status: true, expiresAt: true },
  });

  let changed = 0;
  for (const listing of candidates) {
    const next = listingTransition(listing, graceDays, now);
    if (!next) continue;

    await prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id: listing.id }, data: { status: next } });
      if (next === 'expired') {
        await tx.profile.updateMany({
          where: { ownerId: listing.userId, status: 'published' },
          data: { status: 'paused', unpaidAt: now },
        });
      }
    });
    changed += 1;
  }

  return changed;
}
