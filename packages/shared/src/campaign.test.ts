import { describe, expect, it } from 'vitest';
import { campaignInputSchema, promoCodeSchema } from './campaign';

const base = {
  name: 'Берлин: первые 50',
  trigger: 'first_profile' as const,
  rewardListingDays: 90,
};

const parse = (input: Record<string, unknown>) => campaignInputSchema.safeParse(input);

describe('промокод', () => {
  it('приводится к верхнему регистру', () => {
    // Код диктуют вслух и набирают руками: «berlin50» и «BERLIN50» обязаны
    // быть одним кодом, иначе половина людей не попадёт в акцию.
    expect(promoCodeSchema.parse(' berlin50 ')).toBe('BERLIN50');
  });

  it('не принимает пробелы и кириллицу внутри', () => {
    expect(promoCodeSchema.safeParse('BERLIN 50').success).toBe(false);
    expect(promoCodeSchema.safeParse('БЕРЛИН50').success).toBe(false);
  });
});

describe('награда', () => {
  it('акция без награды не сохраняется', () => {
    // Она бы срабатывала, занимала место в квоте и не давала ничего.
    expect(parse({ ...base, rewardGc: 0, rewardListingDays: 0 }).success).toBe(false);
  });

  it('достаточно одной из двух наград', () => {
    expect(parse({ ...base, rewardGc: 300, rewardListingDays: 0 }).success).toBe(true);
    expect(parse({ ...base, rewardGc: 0, rewardListingDays: 90 }).success).toBe(true);
  });
});

describe('код и вид срабатывания', () => {
  it('акция по коду без кода не сохраняется', () => {
    // Вводить нечего — она не сработает никогда.
    expect(parse({ ...base, trigger: 'promo_code', code: null }).success).toBe(false);
  });

  it('автоматическая акция с кодом не сохраняется', () => {
    // Код у неё вводить некуда, и поле лишь обещало бы способ её получить.
    expect(parse({ ...base, trigger: 'first_profile', code: 'BERLIN50' }).success).toBe(false);
  });

  it('верные сочетания проходят', () => {
    expect(parse({ ...base, trigger: 'promo_code', code: 'BERLIN50' }).success).toBe(true);
    expect(parse({ ...base, trigger: 'first_profile' }).success).toBe(true);
  });
});

describe('срок действия', () => {
  it('конец раньше начала не сохраняется', () => {
    const result = parse({
      ...base,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-09-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('одна граница без второй допустима', () => {
    // «С первого октября и до отмены» — обычная форма акции.
    expect(parse({ ...base, startsAt: '2026-10-01T00:00:00.000Z' }).success).toBe(true);
    expect(parse({ ...base, endsAt: '2026-10-01T00:00:00.000Z' }).success).toBe(true);
  });
});

describe('условия по умолчанию', () => {
  it('пустые означают «любой», а не отсутствие акции', () => {
    const parsed = parse(base);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.cityId).toBeNull();
    expect(parsed.data.advertiserKind).toBeNull();
    // Квота пустая — выдач сколько угодно; ноль здесь означал бы «ни одной».
    expect(parsed.data.quota).toBeNull();
    expect(parsed.data.isActive).toBe(true);
  });

  it('квота не может быть нулевой', () => {
    expect(parse({ ...base, quota: 0 }).success).toBe(false);
  });
});
