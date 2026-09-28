import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { runEventRollup } from './rollup.js';

const NOW = new Date('2026-09-03T10:00:00Z');

/**
 * Различаем четыре роллапа по тексту запроса — тем же приёмом, что и
 * `query.test.ts` для `$queryRaw`: настоящей базы в юнит-тесте нет, а какой
 * именно `INSERT` собрал шаблон, видно только по кускам SQL.
 */
function fakePrisma({
  firstEventAt,
  alreadyRolled,
}: {
  firstEventAt?: Date;
  alreadyRolled?: boolean;
} = {}) {
  const calls: string[] = [];
  const executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = [...strings, ...values.map((v) => JSON.stringify(v))].join(' ');
    if (sql.includes('"ProfileEventDaily"')) calls.push('event');
    else if (sql.includes('"SourceDailyStat"') && sql.includes('AnalyticsSession'))
      calls.push('source');
    else if (sql.includes('"CityDailyStat"') && sql.includes('ProfileEvent')) calls.push('city');
    else if (sql.includes('"CityDailyStat"') && sql.includes('generate_series'))
      calls.push('active-profiles');
    else calls.push('unknown');
    return Promise.resolve(1);
  });

  const prisma = {
    $executeRaw: executeRaw,
    profileEventDaily: {
      findFirst: vi.fn().mockResolvedValue(alreadyRolled ? { day: NOW } : null),
    },
    profileEvent: {
      findFirst: vi.fn().mockResolvedValue(firstEventAt ? { createdAt: firstEventAt } : null),
    },
    // biome-ignore lint/suspicious/noExplicitAny: подделка ровно того куска клиента, который нужен роллапу
  } as any as PrismaClient;

  return { prisma, calls };
}

describe('runEventRollup', () => {
  it('без прежних роллапов заполняет историю задним числом и досчитывает последние сутки', async () => {
    // Первое событие — 2 дня назад: ровно на границе `RECENT_DAYS`, значит
    // один backfill-чанк плюс окно последних суток — два окна на каждый
    // из четырёх роллапов.
    const { prisma, calls } = fakePrisma({ firstEventAt: new Date('2026-09-01T08:00:00Z') });

    const written = await runEventRollup(prisma, NOW);

    expect(written).toBe(8);
    expect(calls.filter((c) => c === 'event')).toHaveLength(2);
    expect(calls.filter((c) => c === 'source')).toHaveLength(2);
    expect(calls.filter((c) => c === 'city')).toHaveLength(2);
    expect(calls.filter((c) => c === 'active-profiles')).toHaveLength(2);
  });

  it('пустой журнал не запускает бэкофилл ни для одного из четырёх роллапов', async () => {
    const { prisma, calls } = fakePrisma({ firstEventAt: undefined });

    const written = await runEventRollup(prisma, NOW);

    expect(written).toBe(4);
    expect(calls).toEqual(expect.arrayContaining(['event', 'source', 'city', 'active-profiles']));
    expect(calls).toHaveLength(4);
  });

  it('уже пересчитанная таблица пропускает бэкофилл и считает только последние сутки', async () => {
    const { prisma, calls } = fakePrisma({ alreadyRolled: true });

    const written = await runEventRollup(prisma, NOW);

    expect(written).toBe(4);
    expect(calls).toHaveLength(4);
  });
});
