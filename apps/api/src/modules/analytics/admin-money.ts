import type { AdvertiserMoneyTotals, OwnMoneyTotals } from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';

type TxRow = {
  kind: 'TOPUP' | 'SPEND' | 'ADJUSTMENT' | 'TOP';
  gcAmount: number;
  eurPaidCents: number | null;
  bonusPercent: number | null;
  createdById: string | null;
};

export const emptyMoney = (): AdvertiserMoneyTotals => ({
  paidEurCents: 0,
  topupCount: 0,
  purchasedGc: 0,
  bonusGc: 0,
  giftedAdminGc: 0,
  giftedCampaignGc: 0,
  giftedOtherGc: 0,
  deductedAdminGc: 0,
  spentListingGc: 0,
  spentTopGc: 0,
});

/**
 * Сводка денег рекламодателя по строкам журнала. Чистая функция — без базы,
 * чтобы правила «что считать подарком» проверялись тестом.
 *
 * - `TOPUP`: деньги и коины за оплату; бонус — часть начисленного сверх
 *   оплаченной суммы (начисление = оплата × (1 + бонус%)).
 * - `ADJUSTMENT` со знаком «+»: подарок. Есть автор — подарил админ. Автора
 *   нет — это система: акции (`campaignGrantGc` — сколько из них выдано по
 *   `CampaignGrant`, чтобы не гадать по тексту примечания) и прочее (например,
 *   стартовая выдача). `ADJUSTMENT` со знаком «−» — списал админ.
 * - `SPEND` — размещение и тариф агентства, `TOP` — места в ТОПе.
 */
export function summarizeMoney(rows: TxRow[], campaignGrantGc: number): AdvertiserMoneyTotals {
  const totals = emptyMoney();
  let systemGifts = 0;

  for (const row of rows) {
    switch (row.kind) {
      case 'TOPUP': {
        totals.topupCount += 1;
        totals.paidEurCents += row.eurPaidCents ?? 0;
        totals.purchasedGc += row.gcAmount;
        const base = Math.round(row.gcAmount / (1 + (row.bonusPercent ?? 0) / 100));
        totals.bonusGc += Math.max(0, row.gcAmount - base);
        break;
      }
      case 'ADJUSTMENT':
        if (row.gcAmount > 0) {
          if (row.createdById) totals.giftedAdminGc += row.gcAmount;
          else systemGifts += row.gcAmount;
        } else {
          totals.deductedAdminGc += -row.gcAmount;
        }
        break;
      case 'SPEND':
        totals.spentListingGc += Math.max(0, -row.gcAmount);
        break;
      case 'TOP':
        totals.spentTopGc += Math.max(0, -row.gcAmount);
        break;
    }
  }

  totals.giftedCampaignGc = Math.min(campaignGrantGc, systemGifts);
  totals.giftedOtherGc = systemGifts - totals.giftedCampaignGc;
  return totals;
}

/** Урезанный вид для самого рекламодателя: подарки — одной суммой, без
 *  разбивки по источнику; списание админом — «корректировка». */
export function toOwnMoney(totals: AdvertiserMoneyTotals): OwnMoneyTotals {
  return {
    paidEurCents: totals.paidEurCents,
    topupCount: totals.topupCount,
    purchasedGc: totals.purchasedGc,
    bonusGc: totals.bonusGc,
    giftedGc: totals.giftedAdminGc + totals.giftedCampaignGc + totals.giftedOtherGc,
    adjustedGc: totals.deductedAdminGc,
    spentListingGc: totals.spentListingGc,
    spentTopGc: totals.spentTopGc,
  };
}

const txSelect = {
  id: true,
  kind: true,
  gcAmount: true,
  eurPaidCents: true,
  bonusPercent: true,
  note: true,
  createdAt: true,
  createdById: true,
} as const;

/**
 * Загрузка журнала и акций рекламодателя и сводка за период и за всё время.
 * Общая у админского отчёта и у отчёта самого рекламодателя: считать деньги
 * двумя разными кодами — верный способ получить два разных ответа.
 */
export async function loadMoney(prisma: PrismaClient, userId: string, since: Date) {
  const [allTx, allGrants] = await Promise.all([
    prisma.billingTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: txSelect,
    }),
    prisma.campaignGrant.findMany({
      where: { userId },
      select: { grantedGc: true, createdAt: true },
    }),
  ]);
  const periodTx = allTx.filter((row) => row.createdAt >= since);
  const grantGc = (rows: typeof allGrants) => rows.reduce((sum, g) => sum + g.grantedGc, 0);
  return {
    periodTx,
    period: summarizeMoney(periodTx, grantGc(allGrants.filter((g) => g.createdAt >= since))),
    allTime: summarizeMoney(allTx, grantGc(allGrants)),
  };
}
