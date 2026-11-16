import { describe, expect, it } from 'vitest';
import { sessionAccess } from './session';

describe('доступ сессии с учётом второго фактора', () => {
  it('посетителю и рекламодателю второй фактор не нужен', () => {
    expect(sessionAccess({ userId: 'u', role: 'client' }, false)).toBe('full');
    expect(sessionAccess({ userId: 'u', role: 'advertiser' }, false)).toBe('full');
  });

  it('сотрудник полноправен только после кода', () => {
    for (const role of ['admin', 'moderator'] as const) {
      expect(sessionAccess({ userId: 'u', role, mfa: 'ok' }, false)).toBe('full');
      expect(sessionAccess({ userId: 'u', role, mfa: 'pending' }, false)).toBe('blocked');
      expect(sessionAccess({ userId: 'u', role, mfa: 'setup' }, false)).toBe('blocked');
    }
  });

  it('до кода открыты только маршруты самого второго фактора', () => {
    expect(sessionAccess({ userId: 'u', role: 'admin', mfa: 'pending' }, true)).toBe('limited');
    expect(sessionAccess({ userId: 'u', role: 'moderator', mfa: 'setup' }, true)).toBe('limited');
  });

  /**
   * Сессии, выданные до появления второго фактора, отметки не несут. Считать
   * их полноправными значило бы оставить старым сессиям обход на месяц
   * (срок жизни сессии, который ещё и продлевается).
   */
  it('сессия сотрудника без отметки недействительна — даже на открытых маршрутах', () => {
    expect(sessionAccess({ userId: 'u', role: 'admin' }, false)).toBe('invalid');
    expect(sessionAccess({ userId: 'u', role: 'moderator' }, true)).toBe('invalid');
    expect(sessionAccess({ userId: 'u', role: 'admin', mfa: 'yes' as never }, false)).toBe(
      'invalid',
    );
  });
});
