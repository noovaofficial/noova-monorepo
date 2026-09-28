import type { EventBatch } from '@noova/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { recordEventBatch } from './batch.js';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fakeFastify({ profiles = [] as unknown[] } = {}) {
  const push = vi.fn();
  const findMany = vi.fn().mockResolvedValue(profiles);
  const redisStore = new Map<string, number>();
  const fastify = {
    prisma: { profile: { findMany } },
    redis: {
      incr: vi.fn(async (key: string) => {
        const next = (redisStore.get(key) ?? 0) + 1;
        redisStore.set(key, next);
        return next;
      }),
      expire: vi.fn(async () => 1),
    },
    eventBuffer: { push },
    log: { warn: vi.fn() },
    // biome-ignore lint/suspicious/noExplicitAny: подделка нужного куска сервера
  } as any as FastifyInstance;
  return { fastify, push, findMany };
}

const request = (session: { userId: string; role: string } | null = null, ip = '10.0.0.5') =>
  ({ ip, session, headers: { 'user-agent': CHROME } }) as unknown as FastifyRequest;

const pageView: EventBatch[number] = {
  name: 'page_view',
  path: '/de/berlin',
  clientTs: Date.now(),
  sessionId: 'abcdefghijklmnop1234',
};

describe('recordEventBatch', () => {
  it('пишет page_view без анкеты', async () => {
    const { fastify, push, findMany } = fakeFastify();
    await recordEventBatch(fastify, request(), [pageView]);
    expect(findMany).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledOnce();
    expect(push.mock.calls[0]?.[0]).toMatchObject({ kind: 'page_view', profileId: null });
  });

  it('gallery_open находит анкету по слагу и берёт её город/категорию', async () => {
    const { fastify, push } = fakeFastify({
      profiles: [{ id: 'p1', slug: 'gloria-berlin', kind: 'escort', city: { slug: 'berlin' } }],
    });
    await recordEventBatch(fastify, request(), [
      { name: 'gallery_open', profileSlug: 'gloria-berlin', path: '/de/p/gloria', clientTs: 1 },
    ]);
    expect(push.mock.calls[0]?.[0]).toMatchObject({
      profileId: 'p1',
      city: 'berlin',
      category: 'escort',
    });
  });

  it('gallery_open с неизвестным слагом молча пропадает', async () => {
    const { fastify, push } = fakeFastify({ profiles: [] });
    await recordEventBatch(fastify, request(), [
      { name: 'gallery_open', profileSlug: 'ghost', path: '/de/p/ghost', clientTs: 1 },
    ]);
    expect(push).not.toHaveBeenCalled();
  });

  it('не пишет заходы владельца анкеты и персонала', async () => {
    const { fastify, push } = fakeFastify();
    for (const role of ['advertiser', 'moderator', 'admin']) {
      await recordEventBatch(fastify, request({ userId: 'u1', role }), [pageView]);
    }
    expect(push).not.toHaveBeenCalled();
  });

  it('после 60 батчей с одного адреса дальнейшие молча пропадают', async () => {
    const { fastify, push } = fakeFastify();
    for (let i = 0; i < 61; i += 1) {
      await recordEventBatch(fastify, request(), [pageView]);
    }
    expect(push).toHaveBeenCalledTimes(60);
  });
});
