import { describe, expect, it } from 'vitest';
import { topExpiry } from './top-expiry';

const now = new Date('2026-07-01T12:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3600 * 1000);

describe('срок ТОПа', () => {
  it('до 48 часов включительно — в часах, минимум час', () => {
    expect(topExpiry(inHours(0.2), now)).toEqual({ kind: 'hours', value: 1 });
    expect(topExpiry(inHours(5), now)).toEqual({ kind: 'hours', value: 5 });
    expect(topExpiry(inHours(48), now)).toEqual({ kind: 'hours', value: 48 });
  });

  it('от 49 часов до недели — в полных сутках', () => {
    expect(topExpiry(inHours(49), now)).toEqual({ kind: 'days', value: 2 });
    expect(topExpiry(inHours(100), now)).toEqual({ kind: 'days', value: 4 });
    expect(topExpiry(inHours(167), now)).toEqual({ kind: 'days', value: 6 });
  });

  it('неделя и больше — дата', () => {
    const later = inHours(24 * 20);
    expect(topExpiry(later, now)).toEqual({ kind: 'date', date: later });
    expect(topExpiry(inHours(168), now).kind).toBe('date');
  });
});
