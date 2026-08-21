import { describe, expect, it } from 'vitest';
import { booleanFromString } from './common';
import { profileQuerySchema } from './profile';

describe('booleanFromString', () => {
  /**
   * Регрессия: `z.coerce.boolean()` приводит по правилам JavaScript, где любая
   * непустая строка истинна. `SMTP_SECURE=false` включал TLS на открытом порту,
   * а `?onlineOnly=false` означал «только онлайн».
   */
  it('понимает «ложные» строки как false', () => {
    for (const value of ['false', '0', 'no', 'off', 'FALSE', ' false ']) {
      expect(booleanFromString().parse(value), value).toBe(false);
    }
  });

  it('понимает «истинные» строки как true', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE']) {
      expect(booleanFromString().parse(value), value).toBe(true);
    }
  });

  it('пропускает настоящие булевы значения', () => {
    expect(booleanFromString().parse(true)).toBe(true);
    expect(booleanFromString().parse(false)).toBe(false);
  });

  it('подставляет значение по умолчанию для пустой строки', () => {
    expect(booleanFromString(false).parse('')).toBe(false);
    expect(booleanFromString(true).parse(undefined)).toBe(true);
  });

  it('отвергает бессмыслицу вместо молчаливого приведения', () => {
    expect(() => booleanFromString().parse('возможно')).toThrow();
  });
});

describe('фильтры каталога', () => {
  it('не превращают onlineOnly=false в true', () => {
    const parsed = profileQuerySchema.parse({ onlineOnly: 'false', verifiedOnly: 'true' });
    expect(parsed.onlineOnly).toBe(false);
    expect(parsed.verifiedOnly).toBe(true);
  });
});
