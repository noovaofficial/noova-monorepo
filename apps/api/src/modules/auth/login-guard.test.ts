import { describe, expect, it } from 'vitest';
import {
  clearLoginFailures,
  isLoginLocked,
  LOGIN_LOCK_SECONDS,
  LOGIN_MAX_FAILURES,
  recordLoginFailure,
} from './login-guard.js';

function fakeRedis() {
  const values = new Map<string, number>();
  const ttl = new Map<string, number>();
  return {
    ttl,
    get: async (key: string) => (values.has(key) ? String(values.get(key)) : null),
    incr: async (key: string) => {
      values.set(key, (values.get(key) ?? 0) + 1);
      return values.get(key) as number;
    },
    expire: async (key: string, seconds: number) => {
      ttl.set(key, seconds);
      return 1;
    },
    del: async (key: string) => (values.delete(key) ? 1 : 0),
  };
}

describe('замок на вход по учётной записи', () => {
  it('закрывает вход после порога неудач и не раньше', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i += 1) {
      await recordLoginFailure(redis as never, 'a@example.com');
    }
    expect(await isLoginLocked(redis as never, 'a@example.com')).toBe(false);
    await recordLoginFailure(redis as never, 'a@example.com');
    expect(await isLoginLocked(redis as never, 'a@example.com')).toBe(true);
  });

  it('считает каждую учётку отдельно', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      await recordLoginFailure(redis as never, 'a@example.com');
    }
    expect(await isLoginLocked(redis as never, 'b@example.com')).toBe(false);
  });

  it('ставит срок один раз — на первой неудаче', async () => {
    const redis = fakeRedis();
    await recordLoginFailure(redis as never, 'a@example.com');
    expect([...redis.ttl.values()]).toEqual([LOGIN_LOCK_SECONDS]);
    redis.ttl.clear();
    await recordLoginFailure(redis as never, 'a@example.com');
    expect(redis.ttl.size).toBe(0);
  });

  it('успешный вход обнуляет счёт', async () => {
    const redis = fakeRedis();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      await recordLoginFailure(redis as never, 'a@example.com');
    }
    await clearLoginFailures(redis as never, 'a@example.com');
    expect(await isLoginLocked(redis as never, 'a@example.com')).toBe(false);
  });
});
