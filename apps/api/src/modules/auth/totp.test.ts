import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUrl,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp';

/** Секрет из приложения B к RFC 6238: ASCII «12345678901234567890». */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('совпадает с эталонными векторами RFC 6238 (SHA-1)', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, expected] of vectors) {
      const step = totpStep(new Date(seconds * 1000));
      expect(totpCode(RFC_SECRET, step, 8)).toBe(expected);
      // Шестизначный код — младшие шесть цифр того же числа.
      expect(totpCode(RFC_SECRET, step)).toBe(expected.slice(2));
    }
  });

  it('base32 обратим и терпит пробелы и регистр', () => {
    const bytes = Buffer.from('любые байты \u0000ÿ');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb oi')).toEqual(Buffer.from('foobar'));
    expect(() => base32Decode('1!')).toThrow();
  });

  it('принимает код текущего и соседних шагов, дальние — нет', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-11-16T12:00:10Z');
    const step = totpStep(now);
    expect(verifyTotp(secret, totpCode(secret, step), { now })).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), { now })).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), { now })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step + 2), { now })).toBeNull();
  });

  it('один и тот же код второй раз не проходит', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-11-16T12:00:10Z');
    const code = totpCode(secret, totpStep(now));
    const used = verifyTotp(secret, code, { now });
    expect(used).not.toBeNull();
    expect(verifyTotp(secret, code, { now, lastStep: used })).toBeNull();
    // Код предыдущего шага после использования текущего тоже не годится.
    expect(
      verifyTotp(secret, totpCode(secret, totpStep(now) - 1), { now, lastStep: used }),
    ).toBeNull();
  });

  it('отвергает всё, что не шесть цифр', () => {
    const secret = generateTotpSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 345', '１２３４５６']) {
      expect(verifyTotp(secret, bad)).toBeNull();
    }
  });

  it('чужой секрет не подходит', () => {
    const now = new Date('2026-11-16T12:00:10Z');
    const code = totpCode(generateTotpSecret(), totpStep(now));
    expect(verifyTotp(generateTotpSecret(), code, { now })).toBeNull();
  });

  it('ссылка для приложения содержит секрет и издателя', () => {
    const url = otpauthUrl('ABC', 'admin@example.com', 'Noova');
    expect(url.startsWith('otpauth://totp/Noova%3Aadmin%40example.com?')).toBe(true);
    expect(url).toContain('secret=ABC');
    expect(url).toContain('issuer=Noova');
  });
});

describe('хранение секрета', () => {
  it('шифрует обратимо и каждый раз по-разному', () => {
    const secret = generateTotpSecret();
    const first = encryptSecret(secret, 'ключ');
    expect(first).not.toContain(secret);
    expect(encryptSecret(secret, 'ключ')).not.toBe(first);
    expect(decryptSecret(first, 'ключ')).toBe(secret);
  });

  it('не расшифровывает чужим ключом и после порчи', () => {
    const stored = encryptSecret('ABC', 'ключ');
    expect(decryptSecret(stored, 'другой')).toBeNull();
    expect(decryptSecret(`${stored.slice(0, -2)}xx`, 'ключ')).toBeNull();
    expect(decryptSecret('мусор', 'ключ')).toBeNull();
  });
});

describe('резервные коды', () => {
  it('случайны и имеют вид XXXXX-XXXXX', () => {
    const codes = new Set(Array.from({ length: 200 }, generateRecoveryCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });

  it('хэш не зависит от регистра, пробелов и дефиса', () => {
    expect(hashRecoveryCode('abcde-fgh23')).toBe(hashRecoveryCode(' ABCDE FGH23 '));
    expect(hashRecoveryCode('ABCDE-FGH23')).not.toBe(hashRecoveryCode('ABCDE-FGH24'));
  });

  it('отличается от шестизначного кода', () => {
    expect(looksLikeRecoveryCode('abcde-fgh23')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
    expect(looksLikeRecoveryCode('abc')).toBe(false);
  });
});
