import { describe, expect, it } from 'vitest';
import { addMonths, listingTransition, nextExpiry } from './listing.js';

const utc = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe('срок размещения', () => {
  it('прибавляет месяцы с зажимом дня', () => {
    // 31 января + месяц — конец февраля, а не 3 марта: иначе человек терял
    // бы оплаченные дни на каждом коротком месяце.
    expect(addMonths(utc('2026-01-31'), 1).toISOString()).toBe(utc('2026-02-28').toISOString());
    expect(addMonths(utc('2028-01-31'), 1).toISOString()).toBe(utc('2028-02-29').toISOString());
    expect(addMonths(utc('2026-03-15'), 12).toISOString()).toBe(utc('2027-03-15').toISOString());
  });

  it('продление идёт от конца текущего срока', () => {
    // Оплата за неделю до истечения не должна съедать эту неделю.
    const now = utc('2026-09-02');
    const current = { status: 'active', expiresAt: utc('2026-09-09') };
    expect(nextExpiry(current, 'm1', now).toISOString()).toBe(utc('2026-10-09').toISOString());
  });

  it('истёкшее и ждущее пополнения стартуют заново от сегодня', () => {
    const now = utc('2026-09-02');
    expect(
      nextExpiry({ status: 'grace', expiresAt: utc('2026-08-31') }, 'm6', now).toISOString(),
    ).toBe(utc('2027-03-02').toISOString());
    expect(
      nextExpiry({ status: 'active', expiresAt: utc('2026-08-01') }, 'm1', now).toISOString(),
    ).toBe(utc('2026-10-02').toISOString());
    expect(nextExpiry(null, 'm12', now).toISOString()).toBe(utc('2027-09-02').toISOString());
  });
});

describe('истечение размещения (D-04, D-09)', () => {
  const now = utc('2026-09-10');

  it('активное с вышедшим сроком уходит в льготные дни', () => {
    expect(listingTransition({ status: 'active', expiresAt: utc('2026-09-09') }, 3, now)).toBe(
      'grace',
    );
    expect(
      listingTransition({ status: 'active', expiresAt: utc('2026-09-11') }, 3, now),
    ).toBeNull();
  });

  it('льготные дни держат анкеты ровно заданный срок', () => {
    // Истекло 7-го, три дня льготы — снятие 10-го, не 9-го.
    expect(listingTransition({ status: 'grace', expiresAt: utc('2026-09-08') }, 3, now)).toBeNull();
    expect(listingTransition({ status: 'grace', expiresAt: utc('2026-09-07') }, 3, now)).toBe(
      'expired',
    );
  });

  it('без льготных дней истекает сразу', () => {
    expect(listingTransition({ status: 'active', expiresAt: utc('2026-09-09') }, 0, now)).toBe(
      'expired',
    );
  });

  it('истёкшее и снятое не трогает', () => {
    expect(
      listingTransition({ status: 'expired', expiresAt: utc('2026-01-01') }, 3, now),
    ).toBeNull();
  });
});
