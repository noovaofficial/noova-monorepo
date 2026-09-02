import { describe, expect, it } from 'vitest';
import { addMonths, nextExpiry } from './listing.js';

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
