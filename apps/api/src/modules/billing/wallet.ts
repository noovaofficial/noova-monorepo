import type { BillingTransaction, BillingTransactionKind, Listing } from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/**
 * Движение GlowCoin (payments.md §4, §8 этап 1).
 *
 * Единственная точка, где меняется `User.glowcoinBalance`. Баланс и запись
 * журнала пишутся в одной транзакции БД под блокировкой строки пользователя:
 * два одновременных списания иначе прочитали бы один и тот же остаток и оба
 * прошли бы. Баланс без журнала — состояние, которое нечем восстановить.
 */

export class InsufficientBalanceError extends Error {
  constructor(
    readonly balance: number,
    readonly requested: number,
  ) {
    super('Недостаточно GlowCoin');
    this.name = 'InsufficientBalanceError';
  }
}

export class WalletOwnerNotFoundError extends Error {
  constructor() {
    super('Пользователь не найден');
    this.name = 'WalletOwnerNotFoundError';
  }
}

/** Баланс не уходит в минус (§4) — проверка отдельно, чтобы её можно было прогнать без базы. */
export function nextBalance(current: number, delta: number): number {
  const next = current + delta;
  if (next < 0) throw new InsufficientBalanceError(current, -delta);
  return next;
}

export type Movement = {
  userId: string;
  kind: BillingTransactionKind;
  /** Знак — направление: + пополнение, − списание. */
  gcAmount: number;
  note?: string | null;
  /** Кто провёл корректировку — для `ADJUSTMENT`. */
  createdById?: string | null;
  eurPaidCents?: number | null;
  bonusPercent?: number | null;
  provider?: string | null;
  providerRef?: string | null;
};

type TransactionRow = {
  id: string;
  kind: BillingTransactionKind;
  gcAmount: number;
  eurPaidCents: number | null;
  bonusPercent: number | null;
  note: string | null;
  createdAt: Date;
};

export function toTransaction(row: TransactionRow): BillingTransaction {
  return {
    id: row.id,
    kind: row.kind,
    gcAmount: row.gcAmount,
    eurPaidCents: row.eurPaidCents,
    bonusPercent: row.bonusPercent,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

type ListingRow = {
  id: string;
  kind: Listing['kind'];
  term: Listing['term'];
  status: Listing['status'];
  activatedAt: Date;
  expiresAt: Date;
};

export function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    kind: row.kind,
    term: row.term,
    status: row.status,
    activatedAt: row.activatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export type MovementResult = { balanceGc: number; transaction: BillingTransaction };

/**
 * Движение внутри уже открытой транзакции — для операций, которым вместе с
 * балансом надо записать что-то ещё (активация пишет ещё и листинг). Снаружи
 * транзакции не вызывать: без `FOR UPDATE` гарантия «не в минус» не держится.
 */
export async function applyMovement(
  tx: Prisma.TransactionClient,
  movement: Movement,
): Promise<MovementResult> {
  // FOR UPDATE, а не optimistic-версия: движений по одному кошельку мало,
  // и ждать секунду на замке дешевле, чем объяснять пользователю «повторите».
  const rows = await tx.$queryRaw<{ glowcoinBalance: number }[]>`
    SELECT "glowcoinBalance" FROM "User" WHERE "id" = ${movement.userId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new WalletOwnerNotFoundError();

  const balanceGc = nextBalance(row.glowcoinBalance, movement.gcAmount);

  const created = await tx.billingTransaction.create({
    data: {
      userId: movement.userId,
      kind: movement.kind,
      gcAmount: movement.gcAmount,
      note: movement.note ?? null,
      createdById: movement.createdById ?? null,
      eurPaidCents: movement.eurPaidCents ?? null,
      bonusPercent: movement.bonusPercent ?? null,
      provider: movement.provider ?? null,
      providerRef: movement.providerRef ?? null,
    },
  });
  await tx.user.update({
    where: { id: movement.userId },
    data: { glowcoinBalance: balanceGc },
  });

  return { balanceGc, transaction: toTransaction(created) };
}

export function applyTransaction(
  prisma: PrismaClient,
  movement: Movement,
): Promise<MovementResult> {
  return prisma.$transaction((tx) => applyMovement(tx, movement));
}
