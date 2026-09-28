import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { EventBuffer } from './buffer.js';

function fakePrisma() {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  return { prisma: { profileEvent: { createMany } } as unknown as PrismaClient, createMany };
}

const row = () => ({
  profileId: null,
  kind: 'page_view' as const,
  userId: null,
  ipHash: 'h',
  sessionId: null,
  city: null,
  category: null,
  path: '/de',
  isBot: false,
  botReason: null,
});

describe('EventBuffer', () => {
  it('не пишет, пока буфер пуст', async () => {
    const { prisma, createMany } = fakePrisma();
    const buffer = new EventBuffer(prisma, { warn: vi.fn() } as never);
    await buffer.flush();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('копит строки и сбрасывает их одной вставкой', async () => {
    const { prisma, createMany } = fakePrisma();
    const buffer = new EventBuffer(prisma, { warn: vi.fn() } as never);
    buffer.push(row());
    buffer.push(row());
    expect(buffer.pending).toBe(2);

    await buffer.flush();
    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany.mock.calls[0]?.[0].data).toHaveLength(2);
    expect(buffer.pending).toBe(0);
  });

  it('сбрасывает сама по достижении порога, не дожидаясь таймера', () => {
    const { prisma, createMany } = fakePrisma();
    const buffer = new EventBuffer(prisma, { warn: vi.fn() } as never);
    for (let i = 0; i < 500; i += 1) buffer.push(row());
    // flush() запущен асинхронно из push(), но очередь уже очищена синхронно
    // тем же вызовом — иначе 501-е событие в этом тесте увеличило бы её.
    expect(buffer.pending).toBe(0);
    expect(createMany).toHaveBeenCalledOnce();
  });

  it('не роняет вызывающего при сбое записи', async () => {
    const { prisma, createMany } = fakePrisma();
    createMany.mockRejectedValueOnce(new Error('база недоступна'));
    const warn = vi.fn();
    const buffer = new EventBuffer(prisma, { warn } as never);
    buffer.push(row());

    await expect(buffer.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
