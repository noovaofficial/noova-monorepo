import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOwnProfiles, publishProfile, updateProfile } from './api';

function mockFetch(payload: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Аргументы первого вызова fetch. Падает внятно, если вызова не было. */
function firstCall(spy: ReturnType<typeof mockFetch>): RequestInit {
  const call = spy.mock.calls[0];
  if (!call) throw new Error('fetch не вызывался');
  return call[1] as RequestInit;
}

function headersOf(spy: ReturnType<typeof mockFetch>): Record<string, string> {
  return firstCall(spy).headers as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('клиент кабинета', () => {
  /**
   * Регрессия: заголовок content-type на POST без тела заставлял Fastify
   * отвечать «Body cannot be empty when content-type is set to
   * application/json», и кнопка «Опубликовать» не работала.
   */
  it('не ставит content-type на POST без тела', async () => {
    const spy = mockFetch({});
    await publishProfile('profile-1').catch(() => undefined);

    expect(headersOf(spy)['content-type']).toBeUndefined();
    expect(firstCall(spy).method).toBe('POST');
  });

  it('ставит content-type, когда тело есть', async () => {
    const spy = mockFetch({});
    await updateProfile('profile-1', { displayName: 'Test' }).catch(() => undefined);

    expect(headersOf(spy)['content-type']).toBe('application/json');
  });

  it('не ставит content-type на GET', async () => {
    const spy = mockFetch([]);
    await fetchOwnProfiles().catch(() => undefined);

    expect(headersOf(spy)['content-type']).toBeUndefined();
  });

  it('всегда шлёт куку сессии', async () => {
    const spy = mockFetch([]);
    await fetchOwnProfiles().catch(() => undefined);

    expect(firstCall(spy).credentials).toBe('include');
  });
});
