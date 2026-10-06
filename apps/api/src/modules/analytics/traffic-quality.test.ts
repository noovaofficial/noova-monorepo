import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { loadTrafficQuality } from './traffic-quality.js';

/**
 * Пять запросов различаются по уникальному для каждого фрагменту SQL —
 * как в `dashboard.test.ts`, живой базы в этом репозитории нет.
 */
function fakePrisma(rows: {
  overview?: Record<string, unknown>[];
  topVisitors?: Record<string, unknown>[];
  silent?: Record<string, unknown>[];
  funnel?: Record<string, unknown>[];
  arrivals?: Record<string, unknown>[];
}) {
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = [...strings, ...values.map((v) => JSON.stringify(v))].join(' ');
    if (sql.includes('"distinctVisitors"')) return Promise.resolve(rows.overview ?? []);
    if (sql.includes('"deviceType"')) return Promise.resolve(rows.topVisitors ?? []);
    if (sql.includes('"withoutEvents"')) return Promise.resolve(rows.silent ?? []);
    if (sql.includes('"sessionsWithActivity"')) return Promise.resolve(rows.funnel ?? []);
    return Promise.resolve(rows.arrivals ?? []);
  });
  // biome-ignore lint/suspicious/noExplicitAny: подделка ровно того куска клиента, который нужен проверке
  return { $queryRaw: queryRaw } as any as PrismaClient;
}

describe('loadTrafficQuality', () => {
  it('без фильтра по кампании возвращает utmCampaign = null', async () => {
    const prisma = fakePrisma({});
    const result = await loadTrafficQuality(prisma, { date: '2026-09-10' });

    expect(result.date).toBe('2026-09-10');
    expect(result.utmCampaign).toBeNull();
  });

  it('передаёт заданную кампанию в ответ как есть', async () => {
    const prisma = fakePrisma({});
    const result = await loadTrafficQuality(prisma, {
      date: '2026-09-10',
      utmCampaign: 'exoclick-autumn',
    });

    expect(result.utmCampaign).toBe('exoclick-autumn');
  });

  it('считает отношение сессий к уникальным посетителям; при нулевых сессиях — null', async () => {
    const prisma = fakePrisma({ overview: [{ sessions: 200, distinctVisitors: 50 }] });
    const result = await loadTrafficQuality(prisma, { date: '2026-09-10' });

    expect(result.sessions).toBe(200);
    expect(result.distinctVisitors).toBe(50);
    expect(result.sessionsPerVisitor).toBe(4);

    const empty = await loadTrafficQuality(fakePrisma({}), { date: '2026-09-10' });
    expect(empty.sessionsPerVisitor).toBeNull();
  });

  it('отдаёт топ посетителей как есть из запроса', async () => {
    const prisma = fakePrisma({
      topVisitors: [{ visitorHash: 'abc', deviceType: 'mobile', sessions: 12 }],
    });
    const result = await loadTrafficQuality(prisma, { date: '2026-09-10' });

    expect(result.topVisitors).toEqual([
      { visitorHash: 'abc', deviceType: 'mobile', sessions: 12 },
    ]);
  });

  it('считает долю сессий без единого события; при нулевых сессиях — null', async () => {
    const prisma = fakePrisma({ silent: [{ total: 1000, withoutEvents: 170 }] });
    const result = await loadTrafficQuality(prisma, { date: '2026-09-10' });

    expect(result.sessionsWithoutEvents).toBe(170);
    expect(result.sessionsWithoutEventsPct).toBe(17);

    const empty = await loadTrafficQuality(fakePrisma({}), { date: '2026-09-10' });
    expect(empty.sessionsWithoutEventsPct).toBeNull();
  });

  it('воронка просмотров и контактов приходит из запроса без искажений', async () => {
    const prisma = fakePrisma({
      funnel: [{ sessionsWithActivity: 180, views: 204, contacts: 4 }],
    });
    const result = await loadTrafficQuality(prisma, { date: '2026-09-10' });

    expect(result.funnelSessionsWithActivity).toBe(180);
    expect(result.funnelViews).toBe(204);
    expect(result.funnelContacts).toBe(4);
  });

  it('распределение по времени прихода возвращается как есть', async () => {
    const prisma = fakePrisma({
      arrivals: [
        { bucket: '02:20', sessions: 3 },
        { bucket: '19:30', sessions: 1 },
      ],
    });
    const result = await loadTrafficQuality(prisma, { date: '2026-09-10' });

    expect(result.arrivals).toEqual([
      { bucket: '02:20', sessions: 3 },
      { bucket: '19:30', sessions: 1 },
    ]);
  });
});
