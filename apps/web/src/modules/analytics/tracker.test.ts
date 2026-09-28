// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Модуль хранит очередь в замыкании — свежий импорт на каждый тест даёт
 *  чистое состояние без экспорта отдельной функции сброса только для тестов. */
async function freshTracker() {
  vi.resetModules();
  return import('./tracker');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // biome-ignore lint/suspicious/noExplicitAny: подчищаем подмену между тестами
  delete (navigator as any).sendBeacon;
});

describe('track', () => {
  it('уходит через sendBeacon по таймеру в пять секунд', async () => {
    const { track } = await freshTracker();
    const sendBeacon = vi.fn().mockReturnValue(true);
    navigator.sendBeacon = sendBeacon;

    track({ name: 'page_view', path: '/de/berlin' });
    expect(sendBeacon).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendBeacon).toHaveBeenCalledOnce();
    const [url, blob] = sendBeacon.mock.calls[0] ?? [];
    expect(url).toContain('/api/v1/e');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('падает на fetch с keepalive, если sendBeacon недоступен', async () => {
    const { track } = await freshTracker();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    track({ name: 'page_view', path: '/de' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('сбрасывает очередь на visibilitychange в hidden', async () => {
    const { track } = await freshTracker();
    const sendBeacon = vi.fn().mockReturnValue(true);
    navigator.sendBeacon = sendBeacon;

    track({ name: 'search_filter', path: '/de/berlin', category: 'escort' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it('сбрасывает очередь на pagehide', async () => {
    const { track } = await freshTracker();
    const sendBeacon = vi.fn().mockReturnValue(true);
    navigator.sendBeacon = sendBeacon;

    track({ name: 'gallery_open', profileSlug: 'gloria-berlin', path: '/de/p/gloria-berlin' });
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it('шлёт сразу по достижении лимита батча, не дожидаясь таймера', async () => {
    const { track } = await freshTracker();
    const sendBeacon = vi.fn().mockReturnValue(true);
    navigator.sendBeacon = sendBeacon;

    for (let i = 0; i < 50; i += 1) track({ name: 'page_view', path: `/de/${i}` });

    expect(sendBeacon).toHaveBeenCalledOnce();
    const blob = sendBeacon.mock.calls[0]?.[1] as Blob;
    const events = JSON.parse(await blob.text());
    expect(events).toHaveLength(50);
  });

  it('никогда не бросает, даже если sendBeacon кидает исключение', async () => {
    const { track } = await freshTracker();
    navigator.sendBeacon = vi.fn(() => {
      throw new Error('boom');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    expect(() => track({ name: 'page_view', path: '/de' })).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
  });
});
