import { describe, expect, it } from 'vitest';
import {
  candidateTiersFor,
  effectiveProfileLimit,
  effectiveTierPriceGc,
  upgradeCostGc,
} from './agency-tariffs';

const TIER = { maxProfiles: 10, prices: { m1: 990, m6: 3990, m12: 5990 } };

describe('effectiveProfileLimit', () => {
  it('индивидуальный override сильнее тарифа', () => {
    expect(effectiveProfileLimit(TIER, 25, 8)).toBe(25);
  });

  it('без override — лимит тарифа', () => {
    expect(effectiveProfileLimit(TIER, null, 8)).toBe(10);
  });

  it('без тарифа и override — аварийный fallback', () => {
    expect(effectiveProfileLimit(null, null, 8)).toBe(8);
  });
});

describe('effectiveTierPriceGc', () => {
  const noCustom = { m1: null, m6: null, m12: null };

  it('индивидуальная цена сильнее цены тарифа', () => {
    expect(effectiveTierPriceGc('m1', TIER, { ...noCustom, m1: 500 }, 100)).toBe(500);
  });

  it('без override — цена тарифа', () => {
    expect(effectiveTierPriceGc('m1', TIER, noCustom, 100)).toBe(990);
  });

  it('без тарифа и override — fallback', () => {
    expect(effectiveTierPriceGc('m1', null, noCustom, 100)).toBe(100);
  });
});

describe('upgradeCostGc', () => {
  it('без оплаченного периода — доплата равна полной цене', () => {
    expect(
      upgradeCostGc({
        targetPriceGc: 3990,
        currentTermPriceGc: 990,
        periodDays: 0,
        remainingDays: 0,
      }),
    ).toBe(3990);
  });

  it('весь период не использован — кредит равен цене текущего тарифа', () => {
    expect(
      upgradeCostGc({
        targetPriceGc: 3990,
        currentTermPriceGc: 990,
        periodDays: 30,
        remainingDays: 30,
      }),
    ).toBe(3990 - 990);
  });

  it('период истёк — кредита нет, доплата полная', () => {
    expect(
      upgradeCostGc({
        targetPriceGc: 3990,
        currentTermPriceGc: 990,
        periodDays: 30,
        remainingDays: 0,
      }),
    ).toBe(3990);
  });

  it('половина периода — кредит вполовину цены текущего тарифа', () => {
    expect(
      upgradeCostGc({
        targetPriceGc: 3990,
        currentTermPriceGc: 990,
        periodDays: 30,
        remainingDays: 15,
      }),
    ).toBe(3990 - 495);
  });

  it('не уходит в минус, если кредит больше цены нового тарифа', () => {
    expect(
      upgradeCostGc({
        targetPriceGc: 100,
        currentTermPriceGc: 5990,
        periodDays: 30,
        remainingDays: 30,
      }),
    ).toBe(0);
  });
});

describe('candidateTiersFor', () => {
  const tiers = [
    { id: 'a', position: 1, maxProfiles: 10, isActive: true },
    { id: 'b', position: 2, maxProfiles: 30, isActive: true },
    { id: 'c', position: 3, maxProfiles: 100, isActive: false },
  ];

  it('оставляет только тарифы, поднимающие потолок выше текущего числа анкет', () => {
    expect(candidateTiersFor(tiers, 10).map((t) => t.id)).toEqual(['b']);
  });

  it('пропускает неактивные тарифы', () => {
    expect(candidateTiersFor(tiers, 30).map((t) => t.id)).toEqual([]);
  });

  it('сортирует по позиции в сетке', () => {
    expect(candidateTiersFor(tiers, 0).map((t) => t.id)).toEqual(['a', 'b']);
  });
});
