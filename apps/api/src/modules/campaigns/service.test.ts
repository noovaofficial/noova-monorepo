import { describe, expect, it } from 'vitest';
import { matchesCampaign } from './service.js';

const NOW = new Date('2026-09-03T12:00:00Z');

const campaign = (overrides: Partial<Parameters<typeof matchesCampaign>[0]> = {}) => ({
  isActive: true,
  startsAt: null,
  endsAt: null,
  cityId: null,
  advertiserKind: null,
  ...overrides,
});

const candidate = (overrides: Partial<Parameters<typeof matchesCampaign>[1]> = {}) => ({
  userId: 'u1',
  advertiserKind: 'individual' as const,
  cityId: 'berlin',
  ...overrides,
});

describe('условия акции', () => {
  it('пустые условия означают «любой»', () => {
    // Так «всем до конца месяца» описывается той же записью, что и
    // «первым 50 салонам в Берлине», — без отдельного вида акции.
    expect(matchesCampaign(campaign(), candidate(), NOW)).toBe(true);
    expect(matchesCampaign(campaign(), candidate({ cityId: 'hamburg' }), NOW)).toBe(true);
  });

  it('выключенная акция не срабатывает', () => {
    expect(matchesCampaign(campaign({ isActive: false }), candidate(), NOW)).toBe(false);
  });
});

describe('город', () => {
  it('совпадает — подходит, не совпадает — нет', () => {
    const berlin = campaign({ cityId: 'berlin' });
    expect(matchesCampaign(berlin, candidate({ cityId: 'berlin' }), NOW)).toBe(true);
    expect(matchesCampaign(berlin, candidate({ cityId: 'hamburg' }), NOW)).toBe(false);
  });

  it('без анкеты городская акция не подходит, а общая — подходит', () => {
    // Город известен только с анкеты: у учётной записи его нет вовсе.
    // Ввести код до первой анкеты можно, но городскую акцию так не получить.
    const noProfile = candidate({ cityId: null });
    expect(matchesCampaign(campaign({ cityId: 'berlin' }), noProfile, NOW)).toBe(false);
    expect(matchesCampaign(campaign(), noProfile, NOW)).toBe(true);
  });
});

describe('тип рекламодателя', () => {
  it('ограничивает, когда задан', () => {
    const salonsOnly = campaign({ advertiserKind: 'salon' });
    expect(matchesCampaign(salonsOnly, candidate({ advertiserKind: 'salon' }), NOW)).toBe(true);
    expect(matchesCampaign(salonsOnly, candidate({ advertiserKind: 'individual' }), NOW)).toBe(
      false,
    );
  });
});

describe('срок действия', () => {
  it('не срабатывает до начала', () => {
    const future = campaign({ startsAt: new Date('2026-09-04T00:00:00Z') });
    expect(matchesCampaign(future, candidate(), NOW)).toBe(false);
  });

  it('срабатывает ровно в момент начала', () => {
    // Граница включительно: акция «с 3 сентября» работает третьего.
    const started = campaign({ startsAt: NOW });
    expect(matchesCampaign(started, candidate(), NOW)).toBe(true);
  });

  it('не срабатывает в момент конца и позже', () => {
    // Конец исключительно: его выставляют полуночью следующего дня, и
    // включи мы эту границу — акция «до 30 сентября» прожила бы лишние сутки.
    expect(matchesCampaign(campaign({ endsAt: NOW }), candidate(), NOW)).toBe(false);
    expect(
      matchesCampaign(campaign({ endsAt: new Date('2026-09-02T00:00:00Z') }), candidate(), NOW),
    ).toBe(false);
  });

  it('срабатывает внутри окна', () => {
    const window = campaign({
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(matchesCampaign(window, candidate(), NOW)).toBe(true);
  });
});

describe('несколько условий разом', () => {
  it('должны совпасть все, а не любое', () => {
    const berlinSalons = campaign({ cityId: 'berlin', advertiserKind: 'salon' });
    expect(
      matchesCampaign(berlinSalons, candidate({ cityId: 'berlin', advertiserKind: 'salon' }), NOW),
    ).toBe(true);
    // Город тот, тип не тот — акция не для него.
    expect(
      matchesCampaign(
        berlinSalons,
        candidate({ cityId: 'berlin', advertiserKind: 'individual' }),
        NOW,
      ),
    ).toBe(false);
  });
});
