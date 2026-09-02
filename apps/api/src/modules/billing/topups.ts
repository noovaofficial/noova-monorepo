import { type CreateTopupResult, grantedGc, type Locale, type TopupOrder } from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { loadBillingConfig } from './config.js';
import {
  createPayment,
  mapOrderStatus,
  PAYMENTO_PROVIDER,
  type PaymentoCallback,
  returnUrlFor,
  verifyPayment,
} from './paymento.js';
import { applyMovement } from './wallet.js';

/**
 * Заказы на пополнение (payments.md, этап 4).
 *
 * Сумма — только из лестницы: фиксированные пакеты, а не произвольный ввод,
 * чтобы бонусный порог был однозначен и для биллинга, и для человека.
 * Начисление фиксируется в заказе при создании и не пересчитывается по
 * колбэку: человек получает то, что ему показали, даже если админ за это
 * время поменял лестницу.
 */

export class TopupTierNotFoundError extends Error {
  constructor(eur: number) {
    super(`Пакета на ${eur} € нет в лестнице пополнений`);
    this.name = 'TopupTierNotFoundError';
  }
}

type OrderRow = {
  id: string;
  eurCents: number;
  grantedGc: number;
  bonusPercent: number;
  status: TopupOrder['status'];
  createdAt: Date;
  paidAt: Date | null;
};

export function toTopupOrder(row: OrderRow): TopupOrder {
  return {
    id: row.id,
    eurCents: row.eurCents,
    grantedGc: row.grantedGc,
    bonusPercent: row.bonusPercent,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

export async function createTopupOrder(
  prisma: PrismaClient,
  input: { userId: string; eur: number; locale: Locale },
): Promise<CreateTopupResult> {
  const config = await loadBillingConfig(prisma);
  const tier = config.topupTiers.find((item) => item.eur === input.eur);
  if (!tier) throw new TopupTierNotFoundError(input.eur);

  const order = await prisma.topupOrder.create({
    data: {
      userId: input.userId,
      eurCents: input.eur * 100,
      bonusPercent: tier.bonusPercent,
      gcPerEur: config.gcPerEur,
      grantedGc: grantedGc(tier.eur, tier.bonusPercent, config.gcPerEur),
      provider: PAYMENTO_PROVIDER,
    },
  });

  // Адрес возврата ведёт на страницу заказа, а не на кошелёк: там человек
  // видит, зачислено или ещё ждём сеть, — по одному кошельку это неясно.
  const returnUrl = returnUrlFor(input.locale, order.id);

  let payment: Awaited<ReturnType<typeof createPayment>>;
  try {
    payment = await createPayment({ eurCents: order.eurCents, orderId: order.id, returnUrl });
  } catch (error) {
    // Заказ без токена — мёртвый: помечаем, чтобы он не висел «создан» вечно
    // и не путал разбор, и отдаём ошибку наверх.
    await prisma.topupOrder.update({ where: { id: order.id }, data: { status: 'failed' } });
    throw error;
  }

  const pending = await prisma.topupOrder.update({
    where: { id: order.id },
    data: { providerToken: payment.token, status: 'pending' },
  });

  return { order: toTopupOrder(pending), paymentUrl: payment.paymentUrl };
}

export type SettleResult = 'credited' | 'already_paid' | 'updated' | 'ignored' | 'unknown_order';

/**
 * Обработка колбэка. Подпись уже проверена маршрутом; здесь — что делать с
 * содержимым. Зачисление идемпотентно дважды: замок на строке заказа и
 * уникальность `(provider, providerRef)` в журнале. Повторная доставка того
 * же колбэка не начислит второй раз.
 */
export async function settleCallback(
  prisma: PrismaClient,
  callback: PaymentoCallback,
): Promise<SettleResult> {
  const order = await prisma.topupOrder.findUnique({ where: { id: callback.orderId } });
  if (!order || order.provider !== PAYMENTO_PROVIDER) return 'unknown_order';
  // Токен из колбэка обязан совпасть с тем, что выдали при создании: чужой
  // токен на наш orderId — это не наш платёж.
  if (order.providerToken !== null && order.providerToken !== callback.token) {
    return 'unknown_order';
  }

  const mapped = mapOrderStatus(callback.orderStatus);

  if (mapped !== 'paid') {
    if (order.status === 'paid' || mapped === null) return 'ignored';
    await prisma.topupOrder.update({
      where: { id: order.id },
      data: { status: mapped, providerStatus: callback.orderStatus },
    });
    return 'updated';
  }

  if (order.status === 'paid') return 'already_paid';

  // Колбэк — сигнал, verify — факт: зачисляем только после подтверждения
  // самим поставщиком, что этот токен оплачен и относится к этому заказу.
  const verified = await verifyPayment(callback.token);
  if (verified.orderId !== order.id) return 'unknown_order';

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string; userId: string | null }[]>`
      SELECT "status", "userId" FROM "TopupOrder" WHERE "id" = ${order.id} FOR UPDATE
    `;
    const locked = rows[0];
    if (!locked || locked.status === 'paid') return 'already_paid';
    // Владелец успел удалить учётку: деньги пришли, а кошелька нет. Заказ
    // помечаем оплаченным, чтобы факт не потерялся, — разбор руками.
    if (!locked.userId) {
      await tx.topupOrder.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt: new Date(), providerStatus: callback.orderStatus },
      });
      return 'ignored';
    }

    const movement = await applyMovement(tx, {
      userId: locked.userId,
      kind: 'TOPUP',
      gcAmount: order.grantedGc,
      eurPaidCents: order.eurCents,
      bonusPercent: order.bonusPercent,
      provider: PAYMENTO_PROVIDER,
      providerRef: callback.token,
    });
    await tx.topupOrder.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        providerStatus: callback.orderStatus,
        providerToken: callback.token,
        transactionId: movement.transaction.id,
      },
    });
    return 'credited';
  });
}
