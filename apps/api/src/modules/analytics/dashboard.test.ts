import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { flagHighDemand, loadDashboard } from './dashboard.js';

const NOW = new Date('2026-09-10T12:00:00Z');

describe('flagHighDemand', () => {
  const avg = 2; // средние 2 контакта на анкету по всем городам с анкетами

  it('город без анкет, но с трафиком или контактами — высокий спрос', () => {
    expect(
      flagHighDemand(
        { activeProfiles: 0, contactsPerProfile: null, sessions: 5, contacts: 0 },
        avg,
      ),
    ).toBe(true);
    expect(
      flagHighDemand(
        { activeProfiles: 0, contactsPerProfile: null, sessions: 0, contacts: 3 },
        avg,
      ),
    ).toBe(true);
  });

  it('город без анкет и без единого события — не флагуется (данных нет вовсе)', () => {
    expect(
      flagHighDemand(
        { activeProfiles: 0, contactsPerProfile: null, sessions: 0, contacts: 0 },
        avg,
      ),
    ).toBe(false);
  });

  it('мало анкет (≤3) и контакты на анкету не ниже среднего — высокий спрос', () => {
    expect(
      flagHighDemand({ activeProfiles: 2, contactsPerProfile: 3, sessions: 10, contacts: 6 }, avg),
    ).toBe(true);
    // Ровно на среднем — тоже считается: порог включительный.
    expect(
      flagHighDemand({ activeProfiles: 2, contactsPerProfile: 2, sessions: 10, contacts: 4 }, avg),
    ).toBe(true);
  });

  it('мало анкет, но контактов на анкету меньше среднего — не флагуется', () => {
    expect(
      flagHighDemand(
        { activeProfiles: 2, contactsPerProfile: 0.5, sessions: 10, contacts: 1 },
        avg,
      ),
    ).toBe(false);
  });

  it('анкет достаточно (> порога) — не флагуется, даже при высоком спросе на анкету', () => {
    expect(
      flagHighDemand(
        { activeProfiles: 10, contactsPerProfile: 5, sessions: 50, contacts: 50 },
        avg,
      ),
    ).toBe(false);
  });
});

/**
 * `$queryRaw` различается по целевой таблице: `SourceDailyStat` для
 * источников, `DISTINCT ON` для снимка анкет (единственное место, где он
 * встречается), остальное `CityDailyStat` — трафик по городам, и
 * `BillingTransaction` — выручка.
 */
function fakePrisma(rows: {
  sources?: Record<string, unknown>[];
  citySnapshot?: Record<string, unknown>[];
  cityTraffic?: Record<string, unknown>[];
  revenue?: Record<string, unknown>[];
}) {
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = [...strings, ...values.map((v) => JSON.stringify(v))].join(' ');
    if (sql.includes('"SourceDailyStat"')) return Promise.resolve(rows.sources ?? []);
    if (sql.includes('DISTINCT ON')) return Promise.resolve(rows.citySnapshot ?? []);
    if (sql.includes('"CityDailyStat"')) return Promise.resolve(rows.cityTraffic ?? []);
    return Promise.resolve(rows.revenue ?? []);
  });
  // biome-ignore lint/suspicious/noExplicitAny: подделка ровно того куска клиента, который нужен дашборду
  return { $queryRaw: queryRaw } as any as PrismaClient;
}

describe('loadDashboard · источники', () => {
  it('суммирует сессии, ботов и контакты по разрезу; стоимость контакта пока пуста', async () => {
    const prisma = fakePrisma({
      sources: [
        {
          source: 'network',
          network: 'exoclick',
          utmCampaign: 'spring',
          sessions: 100,
          botSessions: 10,
          contacts: 20,
        },
      ],
    });

    const result = await loadDashboard(prisma, 'd30', NOW);

    expect(result.sources.rows[0]).toMatchObject({
      source: 'network',
      network: 'exoclick',
      sessions: 100,
      botSessions: 10,
      contacts: 20,
      costPerContactEurCents: null,
    });
    expect(result.sources.totals).toEqual({ sessions: 100, botSessions: 10, contacts: 20 });
  });
});

describe('loadDashboard · города', () => {
  it('не суммирует снимок анкет по дням — берёт последнее известное значение', async () => {
    const prisma = fakePrisma({
      cityTraffic: [
        { city: 'berlin', category: 'escort', sessions: 40, profileViews: 30, contacts: 6 },
      ],
      citySnapshot: [{ city: 'berlin', category: 'escort', activeProfiles: 5 }],
    });

    const result = await loadDashboard(prisma, 'd30', NOW);

    const row = result.cities.rows.find((r) => r.city === 'berlin');
    // Если бы снимок суммировался по дням окна, здесь было бы 5 × 30 дней,
    // а не 5 — ровно то, что вернул подложный снимок.
    expect(row?.activeProfiles).toBe(5);
    expect(row?.contactsPerProfile).toBe(6 / 5);
  });

  it('город с анкетами, но без трафика в окне — не выпадает из отчёта', async () => {
    const prisma = fakePrisma({
      citySnapshot: [{ city: 'munich', category: 'escort', activeProfiles: 2 }],
    });

    const result = await loadDashboard(prisma, 'd30', NOW);

    const row = result.cities.rows.find((r) => r.city === 'munich');
    expect(row).toMatchObject({ sessions: 0, profileViews: 0, contacts: 0, activeProfiles: 2 });
  });

  it('город без анкет, но с трафиком — попадает в отчёт с activeProfiles = 0', async () => {
    const prisma = fakePrisma({
      cityTraffic: [
        { city: 'leipzig', category: 'escort', sessions: 12, profileViews: 0, contacts: 2 },
      ],
    });

    const result = await loadDashboard(prisma, 'd30', NOW);

    const row = result.cities.rows.find((r) => r.city === 'leipzig');
    expect(row).toMatchObject({ activeProfiles: 0, contactsPerProfile: null, highDemand: true });
  });
});

describe('loadDashboard · выручка', () => {
  it('заполняет пропущенные дни нулями и суммирует итоги', async () => {
    const prisma = fakePrisma({
      revenue: [{ day: '2026-09-10', topup: 5000, listing: 300, top: 900 }],
    });

    const result = await loadDashboard(prisma, 'd7', NOW);

    expect(result.revenue.series).toHaveLength(7);
    const day = result.revenue.series.find((p) => p.date === '2026-09-10');
    expect(day).toEqual({
      date: '2026-09-10',
      topupEurCents: 5000,
      spentListingGc: 300,
      spentTopGc: 900,
    });
    const emptyDay = result.revenue.series.find((p) => p.date === '2026-09-09');
    expect(emptyDay).toEqual({
      date: '2026-09-09',
      topupEurCents: 0,
      spentListingGc: 0,
      spentTopGc: 0,
    });
    expect(result.revenue.totals).toEqual({
      topupEurCents: 5000,
      spentListingGc: 300,
      spentTopGc: 900,
    });
  });
});
