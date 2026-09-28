import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { recordSession } from './session.js';

const request = (ua = 'Mozilla/5.0 (iPhone) Mobile') =>
  ({ ip: '10.0.0.1', headers: { 'user-agent': ua } }) as unknown as FastifyRequest;

function fakePrisma(count = 1) {
  const createMany = vi.fn().mockResolvedValue({ count });
  return { prisma: { analyticsSession: { createMany } } as unknown as PrismaClient, createMany };
}

const base = { sessionId: 'abcdefghijklmnop1234', landingPath: '/de', consent: false };

describe('recordSession', () => {
  it('визит с ?utm_source=test атрибутируется как utm', async () => {
    const { prisma, createMany } = fakePrisma();
    await recordSession(prisma, request(), { ...base, utmSource: 'Test' });

    const data = createMany.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ source: 'utm', utmSource: 'test', network: null });
    expect(createMany.mock.calls[0]?.[0].skipDuplicates).toBe(true);
  });

  it('хэширует адрес и не хранит его сырым', async () => {
    const { prisma, createMany } = fakePrisma();
    await recordSession(prisma, request(), base);
    const data = createMany.mock.calls[0]?.[0].data;
    expect(data.visitorHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain('10.0.0.1');
  });

  it('классифицирует реферер и устройство', async () => {
    const { prisma, createMany } = fakePrisma();
    await recordSession(prisma, request(), { ...base, referrerHost: 'www.google.de' });
    expect(createMany.mock.calls[0]?.[0].data).toMatchObject({
      source: 'organic',
      referrerHost: 'google.de',
      deviceType: 'mobile',
    });
  });

  it('не сохраняет идентификатор клика без согласия', async () => {
    const { prisma, createMany } = fakePrisma();
    await recordSession(prisma, request(), { ...base, utmSource: 'exoclick', clickId: 'abc' });
    expect(createMany.mock.calls[0]?.[0].data).toMatchObject({
      source: 'network',
      network: 'exoclick',
      networkClickId: null,
    });
  });

  it('сохраняет идентификатор клика при согласии, но только у сетевого трафика', async () => {
    const { prisma, createMany } = fakePrisma();
    await recordSession(prisma, request(), {
      ...base,
      utmSource: 'exoclick',
      clickId: 'abc',
      consent: true,
    });
    await recordSession(prisma, request(), {
      ...base,
      utmSource: 'other',
      clickId: 'abc',
      consent: true,
    });
    expect(createMany.mock.calls[0]?.[0].data.networkClickId).toBe('abc');
    expect(createMany.mock.calls[1]?.[0].data.networkClickId).toBeNull();
  });

  it('возвращает false для уже существующей сессии', async () => {
    const { prisma } = fakePrisma(0);
    expect(await recordSession(prisma, request(), base)).toBe(false);
  });

  it('размечает сессию бота по User-Agent (фаза 3)', async () => {
    const { prisma, createMany } = fakePrisma();
    await recordSession(prisma, request('curl/8.4.0'), base);
    expect(createMany.mock.calls[0]?.[0].data).toMatchObject({ isBot: true, botReason: 'ua' });
  });

  it('обычный визит сессию ботом не помечает', async () => {
    const { prisma, createMany } = fakePrisma();
    await recordSession(prisma, request(), base);
    expect(createMany.mock.calls[0]?.[0].data).toMatchObject({ isBot: false, botReason: null });
  });
});
