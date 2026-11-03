import { describe, expect, it } from 'vitest';
import {
  adjustBalanceInputSchema,
  billingConfigInputSchema,
  cityMonetizationInputSchema,
  countryMonetizationSchema,
  DEFAULT_BILLING_CONFIG,
  emptyCityPriceOverrides,
  globalBillingConfigSchema,
  grantedGc,
  overlayPrices,
  toPriceBook,
} from './billing';

describe('начисление за пополнение', () => {
  it('воспроизводит лестницу из payments.md §2.1', () => {
    // Таблица документа — договорённость с владельцем продукта. Расхождение
    // здесь означает, что либо формула, либо документ врут.
    const expected: Record<number, number> = {
      10: 100,
      25: 275,
      50: 600,
      100: 1300,
      200: 2800,
      300: 4500,
    };
    const book = toPriceBook(DEFAULT_BILLING_CONFIG);
    for (const tier of book.topupTiers) {
      expect(tier.grantedGc, `${tier.eur} €`).toBe(expected[tier.eur]);
    }
  });

  it('округляет до целого GC', () => {
    // Минимальная единица — 1 GC (§2); дробного начисления быть не может.
    expect(grantedGc(7, 10, 10)).toBe(77);
    expect(grantedGc(7, 15, 10)).toBe(81);
  });
});

describe('конфигурация монетизации', () => {
  it('принимает значения по умолчанию', () => {
    expect(billingConfigInputSchema.safeParse(DEFAULT_BILLING_CONFIG).success).toBe(true);
  });

  it('отклоняет лестницу не по возрастанию', () => {
    // По такой лестнице сервер не выберет бонус однозначно.
    const shuffled = {
      ...DEFAULT_BILLING_CONFIG,
      topupTiers: [
        { eur: 50, bonusPercent: 20 },
        { eur: 10, bonusPercent: 0 },
      ],
    };
    expect(billingConfigInputSchema.safeParse(shuffled).success).toBe(false);

    const duplicated = {
      ...DEFAULT_BILLING_CONFIG,
      topupTiers: [
        { eur: 10, bonusPercent: 0 },
        { eur: 10, bonusPercent: 10 },
      ],
    };
    expect(billingConfigInputSchema.safeParse(duplicated).success).toBe(false);
  });

  it('требует цену на каждый тип и срок', () => {
    // Дырка в сетке — тариф, который нельзя ни показать, ни списать.
    const { m12: _dropped, ...withoutYear } = DEFAULT_BILLING_CONFIG.prices.salon;
    const holed = {
      ...DEFAULT_BILLING_CONFIG,
      prices: { ...DEFAULT_BILLING_CONFIG.prices, salon: withoutYear },
    };
    expect(billingConfigInputSchema.safeParse(holed).success).toBe(false);
  });
});

describe('ручная корректировка баланса', () => {
  const base = { userId: 'u1', note: 'Компенсация за сбой' };

  it('принимает начисление и списание', () => {
    expect(adjustBalanceInputSchema.safeParse({ ...base, gcAmount: 100 }).success).toBe(true);
    expect(adjustBalanceInputSchema.safeParse({ ...base, gcAmount: -100 }).success).toBe(true);
  });

  it('отклоняет нулевую сумму и дробные GC', () => {
    // Нулевая запись в журнале — шум, дробной единицы у GlowCoin нет (§2).
    expect(adjustBalanceInputSchema.safeParse({ ...base, gcAmount: 0 }).success).toBe(false);
    expect(adjustBalanceInputSchema.safeParse({ ...base, gcAmount: 10.5 }).success).toBe(false);
  });

  it('требует причину', () => {
    expect(
      adjustBalanceInputSchema.safeParse({ userId: 'u1', gcAmount: 10, note: '  ' }).success,
    ).toBe(false);
  });
});

describe('монетизация по месту', () => {
  const country = DEFAULT_BILLING_CONFIG.prices;

  it('город переопределяет только заданные ячейки, остальное — как в стране', () => {
    const city = emptyCityPriceOverrides();
    (city.individual as Record<string, number | null>).m1 = 150;

    const grid = overlayPrices(country, city);
    expect(grid.individual.m1).toBe(150);
    expect(grid.individual.m6).toBe(country.individual.m6);
    expect(grid.salon).toEqual(country.salon);
  });

  it('без переопределений город живёт по стране и не меняет её сетку', () => {
    const grid = overlayPrices(country, undefined);
    expect(grid).toEqual(country);
    expect(grid).not.toBe(country);

    overlayPrices(country, emptyCityPriceOverrides());
    expect(country.individual.m1).toBe(DEFAULT_BILLING_CONFIG.prices.individual.m1);
  });

  it('страна без пропусков: дырка в сетке не проходит схему', () => {
    const base = {
      prices: country,
      top: { weekGc: 300, slots: 16 },
      agencyTop: { weekGc: 300, slots: 8 },
    };
    expect(countryMonetizationSchema.safeParse(base).success).toBe(true);

    const { m12: _dropped, ...withoutYear } = country.salon;
    expect(
      countryMonetizationSchema.safeParse({ ...base, prices: { ...country, salon: withoutYear } })
        .success,
    ).toBe(false);
    expect(
      countryMonetizationSchema.safeParse({ ...base, top: { weekGc: 300, slots: 0 } }).success,
    ).toBe(false);
  });

  it('город допускает пустые значения, но не отрицательные', () => {
    const ok = {
      prices: emptyCityPriceOverrides(),
      top: { weekGc: null, slots: null },
    };
    expect(cityMonetizationInputSchema.safeParse(ok).success).toBe(true);
    expect(
      cityMonetizationInputSchema.safeParse({ ...ok, top: { weekGc: -5, slots: null } }).success,
    ).toBe(false);
  });

  it('общие настройки не несут цен и ТОПа — они в странах', () => {
    expect(Object.keys(globalBillingConfigSchema.shape).sort()).toEqual([
      'agencyProfileLimit',
      'gcPerEur',
      'moderatorAdjustLimitGc',
      'topShown',
      'topupTiers',
    ]);
  });
});
