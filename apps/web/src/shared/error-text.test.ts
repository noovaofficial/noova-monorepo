import { describe, expect, it } from 'vitest';
import messages from '../../messages/ru.json';
import { errorCode, errorReason } from './error-text';

const withStatus = (status: number) => Object.assign(new Error('x'), { status });

describe('причина сбоя по ответу сервера', () => {
  it('обрыв сети — отдельная причина', () => {
    expect(errorReason(new TypeError('Failed to fetch'))).toBe('network');
  });

  it.each([
    [401, 'session'],
    [402, 'payment'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [413, 'tooLarge'],
    [400, 'invalid'],
    [422, 'invalid'],
    [429, 'rateLimit'],
    [500, 'server'],
    [503, 'server'],
    [418, 'unknown'],
  ])('статус %i → %s', (status, reason) => {
    expect(errorReason(withStatus(status))).toBe(reason);
  });

  it('ошибка без статуса не получает выдуманной причины', () => {
    expect(errorReason(new Error('что-то'))).toBe('unknown');
    expect(errorReason(null)).toBe('unknown');
  });
});

describe('код причины от сервера', () => {
  it('читается из ошибки', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'company_slug_taken' }))).toBe(
      'company_slug_taken',
    );
    expect(errorCode(new Error('x'))).toBeNull();
  });

  it('на каждый код сервера есть перевод, чтобы по-русски с бэка на экран не попадало', () => {
    const codes = ['company_slug_taken', 'city_exists', 'promo_code_taken', 'group_exists'];
    for (const code of codes) {
      expect((messages.error as Record<string, string>)[`code_${code}`]).toBeTruthy();
    }
  });
});
