import { describe, expect, it } from 'vitest';
import { changePct, ratioCents, sortUsers, summarizeKinds } from './overview';

const user = (over: Partial<Parameters<typeof summarizeKinds>[0][number]>) => ({
  userId: 'u',
  email: 'a@x.de',
  kind: 'agency' as const,
  profiles: 0,
  publishedProfiles: 0,
  paidEurCents: 0,
  topupCount: 0,
  viewsReg: 0,
  viewsAnon: 0,
  clicksReg: 0,
  clicksAnon: 0,
  giftedGc: 0,
  ...over,
});

describe('отношения обзора', () => {
  it('деление на ноль даёт null, а не NaN', () => {
    expect(ratioCents(1000, 0)).toBeNull();
    expect(ratioCents(1000, 3)).toBe(333);
    expect(changePct(100, 0)).toBeNull();
  });

  it('изменение к прошлому периоду — процент с десятой', () => {
    expect(changePct(118, 100)).toBe(18);
    expect(changePct(50, 200)).toBe(-75);
    expect(changePct(103, 100)).toBe(3);
  });
});

describe('сводка по типам', () => {
  const users = [
    user({
      kind: 'agency',
      paidEurCents: 30000,
      publishedProfiles: 3,
      profiles: 4,
      viewsReg: 1,
      viewsAnon: 9,
    }),
    user({ kind: 'agency', paidEurCents: 0, profiles: 2 }),
    user({ kind: 'individual', paidEurCents: 10000, publishedProfiles: 1, profiles: 1 }),
  ];
  const byKind = Object.fromEntries(summarizeKinds(users).map((k) => [k.kind, k]));

  it('доли выручки, платящие и деньги на анкету и рекламодателя', () => {
    expect(byKind.agency?.sharePct).toBe(75);
    expect(byKind.individual?.sharePct).toBe(25);
    expect(byKind.agency?.advertisers).toBe(2);
    expect(byKind.agency?.payingAdvertisers).toBe(1);
    expect(byKind.agency?.eurPerAdvertiserCents).toBe(15000);
    expect(byKind.agency?.eurPerPublishedCents).toBe(10000);
    expect(byKind.agency?.views).toEqual({ registered: 1, anonymous: 9 });
  });

  it('тип без рекламодателей — нули и null, а не ошибка', () => {
    expect(byKind.salon?.advertisers).toBe(0);
    expect(byKind.salon?.sharePct).toBe(0);
    expect(byKind.salon?.eurPerAdvertiserCents).toBeNull();
  });
});

describe('сортировка таблицы', () => {
  const a = user({ userId: 'a', email: 'a@x.de', paidEurCents: 100, publishedProfiles: 0 });
  const b = user({ userId: 'b', email: 'b@x.de', paidEurCents: 300, publishedProfiles: 3 });
  const c = user({ userId: 'c', email: 'c@x.de', paidEurCents: 300, publishedProfiles: 1 });

  it('по убыванию оплат, при равенстве — по почте', () => {
    expect(sortUsers([a, c, b], 'paid', 'desc').map((u) => u.userId)).toEqual(['b', 'c', 'a']);
  });

  it('«нет данных» в отношении уходит вниз при убывании', () => {
    expect(sortUsers([a, b, c], 'eurPerProfile', 'desc').map((u) => u.userId)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });
});
