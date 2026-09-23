import { describe, expect, it } from 'vitest';
import { summarizeMoney, toOwnMoney } from './admin-money';

const tx = (over: Partial<Parameters<typeof summarizeMoney>[0][number]>) => ({
  kind: 'SPEND' as const,
  gcAmount: 0,
  eurPaidCents: null,
  bonusPercent: null,
  createdById: null,
  ...over,
});

describe('сводка денег рекламодателя', () => {
  it('пополнение: евро, коины и бонус отдельно', () => {
    // 100 € с бонусом 10% -> 110 GC при курсе 1:1; бонус — 10.
    const result = summarizeMoney(
      [tx({ kind: 'TOPUP', gcAmount: 110, eurPaidCents: 10000, bonusPercent: 10 })],
      0,
    );
    expect(result.paidEurCents).toBe(10000);
    expect(result.purchasedGc).toBe(110);
    expect(result.bonusGc).toBe(10);
    expect(result.topupCount).toBe(1);
  });

  it('подарки делятся на админские, акции и прочее системное', () => {
    const result = summarizeMoney(
      [
        tx({ kind: 'ADJUSTMENT', gcAmount: 50, createdById: 'admin1' }),
        tx({ kind: 'ADJUSTMENT', gcAmount: 30 }), // акция
        tx({ kind: 'ADJUSTMENT', gcAmount: 20 }), // стартовая выдача
      ],
      30,
    );
    expect(result.giftedAdminGc).toBe(50);
    expect(result.giftedCampaignGc).toBe(30);
    expect(result.giftedOtherGc).toBe(20);
  });

  it('акций больше, чем системных подарков за срез, — не уходим в минус', () => {
    const result = summarizeMoney([tx({ kind: 'ADJUSTMENT', gcAmount: 10 })], 999);
    expect(result.giftedCampaignGc).toBe(10);
    expect(result.giftedOtherGc).toBe(0);
  });

  it('отрицательная корректировка — списание админом, не подарок', () => {
    const result = summarizeMoney(
      [tx({ kind: 'ADJUSTMENT', gcAmount: -40, createdById: 'admin1' })],
      0,
    );
    expect(result.deductedAdminGc).toBe(40);
    expect(result.giftedAdminGc).toBe(0);
  });

  it('траты: размещение и ТОП отдельно', () => {
    const result = summarizeMoney(
      [tx({ kind: 'SPEND', gcAmount: -300 }), tx({ kind: 'TOP', gcAmount: -100 })],
      0,
    );
    expect(result.spentListingGc).toBe(300);
    expect(result.spentTopGc).toBe(100);
  });
});

describe('вид для самого рекламодателя', () => {
  it('подарки — одной суммой, списание админом — корректировка, внутреннего не видно', () => {
    const own = toOwnMoney(
      summarizeMoney(
        [
          tx({ kind: 'ADJUSTMENT', gcAmount: 50, createdById: 'admin1' }),
          tx({ kind: 'ADJUSTMENT', gcAmount: 30 }),
          tx({ kind: 'ADJUSTMENT', gcAmount: -5, createdById: 'admin1' }),
        ],
        30,
      ),
    );
    expect(own.giftedGc).toBe(80);
    expect(own.adjustedGc).toBe(5);
    expect(Object.keys(own)).not.toContain('giftedAdminGc');
    expect(Object.keys(own)).not.toContain('giftedCampaignGc');
  });
});
