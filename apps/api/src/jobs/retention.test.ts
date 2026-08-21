import { describe, expect, it, vi } from 'vitest';
import { purgeContactReveals } from '../modules/profiles/retention.js';
import { purgeAuthTokens, purgeDeletedAccounts, purgeModerationActions } from './retention.js';

const NOW = new Date('2027-01-01T00:00:00Z');
const days = (n: number) => n * 24 * 60 * 60 * 1000;

function fakePrisma(count = 3) {
  const deleteMany = vi.fn().mockResolvedValue({ count });
  return {
    deleteMany,
    client: {
      contactReveal: { deleteMany },
      authToken: { deleteMany },
      moderationAction: { deleteMany },
      // biome-ignore lint/suspicious/noExplicitAny: см. выше
    } as any,
  };
}

describe('сроки хранения', () => {
  it('журнал раскрытий режется ровно по переданному сроку', () => {
    const { client, deleteMany } = fakePrisma();
    return purgeContactReveals(client, 365, NOW).then(() => {
      const cutoff = deleteMany.mock.calls[0]?.[0].where.createdAt.lt as Date;
      // Граница ровно на сроке: лишний день здесь — лишний день хранения
      // следа «этот адрес смотрел эту анкету».
      expect(NOW.getTime() - cutoff.getTime()).toBe(days(365));
    });
  });

  it('журнал модерации режется по своему сроку', async () => {
    const { client, deleteMany } = fakePrisma();
    const removed = await purgeModerationActions(client, 90, NOW);
    expect(removed).toBe(3);
    const cutoff = deleteMany.mock.calls[0]?.[0].where.createdAt.lt as Date;
    expect(NOW.getTime() - cutoff.getTime()).toBe(days(90));
  });

  it('живой неиспользованный токен не трогается', async () => {
    const { client, deleteMany } = fakePrisma();
    await purgeAuthTokens(client, 7, NOW);
    const where = deleteMany.mock.calls[0]?.[0].where;

    // Условие только по отработавшим: без этого чистка обрывала бы ссылку
    // из письма раньше её собственного срока.
    expect(where.OR).toEqual([
      { expiresAt: { lt: new Date(NOW.getTime() - days(7)) } },
      { usedAt: { lt: new Date(NOW.getTime() - days(7)) } },
    ]);
    expect(where.createdAt).toBeUndefined();
  });
});

describe('purgeDeletedAccounts', () => {
  it('удаляет файлы до строк', async () => {
    // Каскад про хранилище не знает: удали пользователя первым, и объекты
    // останутся в бакете навсегда, причём одобренные — под публичным
    // префиксом.
    const deleted: string[] = [];
    const order: string[] = [];
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'u1', profiles: [{ photos: [{ storageKey: 'public/p1' }] }] }]);
    const del = vi.fn().mockImplementation(async () => {
      order.push('row');
    });
    // biome-ignore lint/suspicious/noExplicitAny: подменяем используемый кусок клиента
    const prisma = { user: { findMany, delete: del } } as any;

    const removed = await purgeDeletedAccounts(
      prisma,
      14,
      async (key) => {
        deleted.push(key);
        order.push('file');
      },
      new Date('2027-01-01T00:00:00Z'),
    );

    expect(removed).toBe(1);
    // Помощник получает ключ фотографии целиком: перечислять размеры —
    // его забота, и делает он это в одном месте на весь проект.
    expect(deleted).toEqual(['public/p1']);
    // Файлы раньше строки: иначе список ключей взять уже негде.
    expect(order.indexOf('file')).toBeLessThan(order.indexOf('row'));
  });

  it('не удаляет учётку, если файлы удалить не удалось', async () => {
    // Иначе строки исчезнут, ключи потеряются, а файлы останутся в бакете
    // навсегда. Лучше не удалить сейчас и повторить следующим циклом.
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'u1', profiles: [{ photos: [{ storageKey: 'public/p1' }] }] }]);
    const del = vi.fn().mockResolvedValue({});
    // biome-ignore lint/suspicious/noExplicitAny: см. выше
    const prisma = { user: { findMany, delete: del } } as any;

    await expect(
      purgeDeletedAccounts(prisma, 14, async () => {
        throw new Error('хранилище недоступно');
      }),
    ).rejects.toThrow('хранилище недоступно');
    expect(del).not.toHaveBeenCalled();
  });
});
