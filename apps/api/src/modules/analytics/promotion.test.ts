import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { loadPromotionEffects } from './promotion.js';

const NOW = new Date('2026-09-10T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const scope = () => ({
  profiles: [{ id: 'p0', displayName: 'Анкета 0', slug: 'anketa-0' }],
  ownerId: 'owner',
});

function fakePrisma(
  placement: { startsAt: Date; expiresAt: Date } | null,
  contactsByWindow: number[],
) {
  const findMany = vi
    .fn()
    .mockResolvedValue(
      placement
        ? [{ profileId: 'p0', startsAt: placement.startsAt, expiresAt: placement.expiresAt }]
        : [],
    );
  // Первый вызов — «во время», второй — «до»: `Promise.all` их не
  // упорядочивает документально, но в реализации именно такой порядок.
  let call = 0;
  const queryRaw = vi.fn(() => Promise.resolve([{ n: contactsByWindow[call++] ?? 0 }]));
  const prisma = {
    topPlacement: { findMany },
    $queryRaw: queryRaw,
    // biome-ignore lint/suspicious/noExplicitAny: подделка нужного куска клиента
  } as any as PrismaClient;
  return { prisma, findMany, queryRaw };
}

describe('loadPromotionEffects', () => {
  it('пусто, если анкету никогда не поднимали в ТОП', async () => {
    const { prisma } = fakePrisma(null, []);
    expect(await loadPromotionEffects(prisma, scope(), NOW)).toEqual([]);
  });

  it('считает контакты в день отдельно за время ТОПа и за 14 дней до', async () => {
    const startsAt = new Date(NOW.getTime() - 3 * DAY_MS);
    const expiresAt = new Date(NOW.getTime() + 4 * DAY_MS);
    // Во время: 6 контактов за 3 прошедших дня → 2/день.
    // До: 28 контактов за 14 дней → 2/день.
    const { prisma } = fakePrisma({ startsAt, expiresAt }, [6, 28]);

    const [effect] = await loadPromotionEffects(prisma, scope(), NOW);

    expect(effect).toMatchObject({
      profileId: 'p0',
      contactsPerDayDuring: 2,
      contactsPerDayBefore: 2,
    });
  });

  it('считает «во время» только до текущего момента, если ТОП ещё активен', async () => {
    const startsAt = new Date(NOW.getTime() - 2 * DAY_MS);
    const expiresAt = new Date(NOW.getTime() + 5 * DAY_MS);
    const { prisma, queryRaw } = fakePrisma({ startsAt, expiresAt }, [4, 0]);

    await loadPromotionEffects(prisma, scope(), NOW);

    // Первый запрос («во время») должен закончиться на `NOW`, а не на
    // `expiresAt`, который ещё не наступил, — иначе окно включало бы
    // будущее и делило бы на дни, которых ещё не было.
    const firstCallSql = queryRaw.mock.calls[0]?.map((v) => JSON.stringify(v)).join(' ') ?? '';
    expect(firstCallSql).toContain(NOW.toISOString());
    expect(firstCallSql).not.toContain(expiresAt.toISOString());
  });

  it('не делит на ноль, если ТОП начался только что', async () => {
    const startsAt = NOW;
    const expiresAt = new Date(NOW.getTime() + 7 * DAY_MS);
    const { prisma } = fakePrisma({ startsAt, expiresAt }, [3, 0]);

    const [effect] = await loadPromotionEffects(prisma, scope(), NOW);

    // Длительность «во время» зажата минимум в одни сутки — иначе 3
    // контакта за секунды дали бы астрономическое число в день.
    expect(effect?.contactsPerDayDuring).toBe(3);
  });

  it('не показывает размещение старше 90 дней', async () => {
    const staleBefore = new Date(NOW.getTime() - 100 * DAY_MS);
    const { prisma, findMany } = fakePrisma({ startsAt: staleBefore, expiresAt: staleBefore }, []);
    // findMany сам фильтрует по expiresAt — подделка здесь просто должна
    // получить корректный `where`, а не искусственно вернуть пусто.
    findMany.mockResolvedValue([]);

    expect(await loadPromotionEffects(prisma, scope(), NOW)).toEqual([]);
  });
});
