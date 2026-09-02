import type { FastifyInstance, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { recordProfileEvent } from './events.js';

/**
 * Redis отвечает «OK» на первый `SET NX` и `null` на повторный — ровно так,
 * как ведёт себя настоящий, пока ключ жив.
 */
function fakeFastify({ redisFails = false }: { redisFails?: boolean } = {}) {
  const seen = new Set<string>();
  const create = vi.fn().mockResolvedValue({});

  const fastify = {
    prisma: { profileEvent: { create } },
    redis: {
      set: vi.fn(async (key: string) => {
        if (redisFails) throw new Error('redis недоступен');
        if (seen.has(key)) return null;
        seen.add(key);
        return 'OK';
      }),
    },
    log: { warn: vi.fn() },
    // biome-ignore lint/suspicious/noExplicitAny: подделка нужного куска сервера
  } as any as FastifyInstance;

  return { fastify, create };
}

const request = (session: { userId: string; role: string } | null = null, ip = '10.0.0.1') =>
  ({ ip, session }) as unknown as FastifyRequest;

describe('кого считаем', () => {
  it('считает гостя', async () => {
    const { fastify, create } = fakeFastify();
    expect(await recordProfileEvent(fastify, request(), { kind: 'view', profileId: 'p1' })).toBe(
      true,
    );
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0].data.userId).toBeNull();
  });

  it('не считает заходы самого рекламодателя и персонала', async () => {
    const { fastify, create } = fakeFastify();

    for (const role of ['advertiser', 'moderator', 'admin']) {
      await recordProfileEvent(fastify, request({ userId: 'u1', role }), {
        kind: 'view',
        profileId: 'p1',
      });
    }

    // Владелица открывает свою анкету чаще любого посетителя — посмотреть,
    // как она выглядит. Считай мы это, отчёт показывал бы её саму.
    expect(create).not.toHaveBeenCalled();
  });

  it('пишет раскрытие контактов от кого угодно', async () => {
    const { fastify, create } = fakeFastify();

    await recordProfileEvent(fastify, request({ userId: 'u1', role: 'advertiser' }), {
      kind: 'contact_reveal',
      profileId: 'p1',
    });

    // Журнал раскрытий — ещё и антифрод, а он теряет смысл, если часть
    // обращений в него не попадает. Владелец отсеивается на чтении отчёта.
    expect(create).toHaveBeenCalledOnce();
  });
});

describe('схлопывание повторов', () => {
  it('засчитывает один просмотр анкеты на посетителя в пределах окна', async () => {
    const { fastify, create } = fakeFastify();

    expect(await recordProfileEvent(fastify, request(), { kind: 'view', profileId: 'p1' })).toBe(
      true,
    );
    expect(await recordProfileEvent(fastify, request(), { kind: 'view', profileId: 'p1' })).toBe(
      false,
    );
    // Другая анкета — другое событие: окно про пару «посетитель + анкета».
    expect(await recordProfileEvent(fastify, request(), { kind: 'view', profileId: 'p2' })).toBe(
      true,
    );

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('различает посетителей по учётной записи, а не только по адресу', async () => {
    const { fastify, create } = fakeFastify();
    const shared = '203.0.113.7';

    await recordProfileEvent(fastify, request({ userId: 'a', role: 'client' }, shared), {
      kind: 'view',
      profileId: 'p1',
    });
    // Тот же адрес — общий Wi-Fi или мобильный NAT. Считать это одним
    // человеком значит терять просмотры целой сети.
    await recordProfileEvent(fastify, request({ userId: 'b', role: 'client' }, shared), {
      kind: 'view',
      profileId: 'p1',
    });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('считает клики по разным каналам по отдельности', async () => {
    const { fastify, create } = fakeFastify();

    await recordProfileEvent(fastify, request(), {
      kind: 'contact_click',
      profileId: 'p1',
      contactType: 'phone',
    });
    // Позвонил и следом написал в WhatsApp — это два обращения, а не одно.
    await recordProfileEvent(fastify, request(), {
      kind: 'contact_click',
      profileId: 'p1',
      contactType: 'whatsapp',
    });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('не схлопывает раскрытия контактов', async () => {
    const { fastify, create } = fakeFastify();

    await recordProfileEvent(fastify, request(), { kind: 'contact_reveal', profileId: 'p1' });
    await recordProfileEvent(fastify, request(), { kind: 'contact_reveal', profileId: 'p1' });

    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('устойчивость', () => {
  it('пишет событие, даже если Redis недоступен', async () => {
    const { fastify, create } = fakeFastify({ redisFails: true });

    // Пропущенное событие восстановить нечем, а лишняя строка безвредна.
    expect(await recordProfileEvent(fastify, request(), { kind: 'view', profileId: 'p1' })).toBe(
      true,
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it('не роняет ответ, если запись просмотра не удалась', async () => {
    const { fastify, create } = fakeFastify();
    create.mockRejectedValueOnce(new Error('база недоступна'));

    // Посетитель пришёл за анкетой, а не за нашей статистикой.
    await expect(
      recordProfileEvent(fastify, request(), { kind: 'view', profileId: 'p1' }),
    ).resolves.toBe(false);
  });

  it('роняет раскрытие контактов, если журнал не записался', async () => {
    const { fastify, create } = fakeFastify();
    create.mockRejectedValueOnce(new Error('база недоступна'));

    // Отдать контакты и не записать обращение — это молча выключить антифрод.
    await expect(
      recordProfileEvent(fastify, request(), { kind: 'contact_reveal', profileId: 'p1' }),
    ).rejects.toThrow();
  });
});
