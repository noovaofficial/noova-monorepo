import type { FastifyInstance, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { classifyEventBot, classifySessionBot } from './bot.js';

function fakeFastify() {
  const store = new Map<string, number>();
  const incr = vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  });
  const expire = vi.fn(async () => 1);
  const fastify = {
    redis: { incr, expire },
    log: { warn: vi.fn() },
    // biome-ignore lint/suspicious/noExplicitAny: подделка нужного куска сервера
  } as any as FastifyInstance;
  return fastify;
}

const request = (ua: string, ip = '10.0.0.1') =>
  ({ ip, headers: { 'user-agent': ua } }) as unknown as FastifyRequest;

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('classifySessionBot', () => {
  it('визит headless-браузера размечается как ua', () => {
    expect(
      classifySessionBot(request('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0')),
    ).toEqual({ isBot: true, botReason: 'ua' });
  });

  it('обычный браузер ботом не считается', () => {
    expect(classifySessionBot(request(CHROME))).toEqual({ isBot: false, botReason: null });
  });
});

describe('classifyEventBot', () => {
  it('контактное событие без взаимодействия — no_interaction', async () => {
    const fastify = fakeFastify();
    expect(
      await classifyEventBot(fastify, request(CHROME), {
        kind: 'contact_click',
        interacted: false,
      }),
    ).toEqual({ isBot: true, botReason: 'no_interaction' });
  });

  it('контакт раньше 1.5 секунды после загрузки — too_fast', async () => {
    const fastify = fakeFastify();
    expect(
      await classifyEventBot(fastify, request(CHROME), {
        kind: 'contact_reveal',
        interacted: true,
        msSincePageLoad: 400,
      }),
    ).toEqual({ isBot: true, botReason: 'too_fast' });
  });

  it('живое взаимодействие и обычное время — не бот', async () => {
    const fastify = fakeFastify();
    expect(
      await classifyEventBot(fastify, request(CHROME), {
        kind: 'contact_click',
        interacted: true,
        msSincePageLoad: 4000,
      }),
    ).toEqual({ isBot: false, botReason: null });
  });

  it('просмотр не проверяется на взаимодействие и скорость клика', async () => {
    const fastify = fakeFastify();
    expect(
      await classifyEventBot(fastify, request(CHROME), {
        kind: 'view',
        interacted: false,
        msSincePageLoad: 0,
      }),
    ).toEqual({ isBot: false, botReason: null });
  });

  it('31-й просмотр за 5 минут в одной сессии — velocity', async () => {
    const fastify = fakeFastify();
    let last: Awaited<ReturnType<typeof classifyEventBot>> | undefined;
    for (let i = 0; i < 31; i += 1) {
      last = await classifyEventBot(fastify, request(CHROME), {
        kind: 'view',
        sessionId: 's1',
      });
    }
    expect(last).toEqual({ isBot: true, botReason: 'velocity' });
  });

  it('счётчик скорости отдельный для каждой сессии', async () => {
    const fastify = fakeFastify();
    for (let i = 0; i < 30; i += 1) {
      await classifyEventBot(fastify, request(CHROME), { kind: 'view', sessionId: 's1' });
    }
    expect(
      await classifyEventBot(fastify, request(CHROME), { kind: 'view', sessionId: 's2' }),
    ).toEqual({ isBot: false, botReason: null });
  });

  it('User-Agent важнее остальных правил', async () => {
    const fastify = fakeFastify();
    expect(
      await classifyEventBot(fastify, request('curl/8.4.0'), {
        kind: 'contact_click',
        interacted: true,
        msSincePageLoad: 5000,
      }),
    ).toEqual({ isBot: true, botReason: 'ua' });
  });
});
