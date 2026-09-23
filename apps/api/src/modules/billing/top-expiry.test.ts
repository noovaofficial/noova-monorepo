import { describe, expect, it } from 'vitest';
import { expiryAfterGrant } from './top';

const now = new Date('2026-07-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('срок места после выдачи админом', () => {
  it('места нет — считаем от сейчас', () => {
    const r = expiryAfterGrant(null, now, 7 * DAY);
    expect(r.extended).toBe(false);
    expect(r.expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it('место истекло — тоже от сейчас, а не от старого конца', () => {
    const r = expiryAfterGrant(
      { status: 'expired', expiresAt: new Date(now.getTime() - DAY) },
      now,
      7 * DAY,
    );
    expect(r.extended).toBe(false);
    expect(r.expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it('место действует — продлеваем от его конца, остаток не теряется', () => {
    const end = new Date(now.getTime() + 3 * DAY);
    const r = expiryAfterGrant({ status: 'active', expiresAt: end }, now, 7 * DAY);
    expect(r.extended).toBe(true);
    expect(r.expiresAt.getTime()).toBe(end.getTime() + 7 * DAY);
  });

  it('статус active, но срок уже вышел (задача не успела снять) — как истёкшее', () => {
    const r = expiryAfterGrant(
      { status: 'active', expiresAt: new Date(now.getTime() - 1000) },
      now,
      DAY,
    );
    expect(r.extended).toBe(false);
    expect(r.expiresAt.getTime()).toBe(now.getTime() + DAY);
  });
});
