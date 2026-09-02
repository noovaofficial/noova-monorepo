import {
  type ActivateListingResult,
  type PlanKind,
  type PlanTerm,
  TERM_MONTHS,
} from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { applyMovement, toListing } from './wallet.js';

/**
 * Активация размещения (payments.md §4, этап 3).
 *
 * Списание и листинг — в одной транзакции: списать и не выдать размещение
 * (или наоборот) значит спор, который нечем разобрать. Цена приходит из
 * прайса на сервере, никогда из запроса.
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
 * или ждущее пополнения размещение стартует заново от сегодня.
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

export function activateListing(
  prisma: PrismaClient,
  activation: Activation,
): Promise<ActivateListingResult> {
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
      where: { userId: activation.userId, status: { not: 'expired' } },
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

    return { listing: toListing(listing), ...spend };
  });
}
