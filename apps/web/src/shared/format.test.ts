import { describe, expect, it } from 'vitest';
import { currencySymbol, formatMoney, minorFactor } from './format';

describe('валюта цен анкет', () => {
  it('минорная единица берётся из ISO 4217, а не «всегда 100»', () => {
    expect(minorFactor('EUR')).toBe(100);
    expect(minorFactor('CZK')).toBe(100);
    expect(minorFactor('JPY')).toBe(1);
    expect(minorFactor('KRW')).toBe(1);
  });

  it('неизвестный код не роняет форму', () => {
    expect(minorFactor('???')).toBe(100);
    expect(currencySymbol('???', 'ru')).toBe('???');
  });

  it('знак валюты на языке интерфейса', () => {
    expect(currencySymbol('EUR', 'en')).toBe('€');
  });

  it('сумма без копеек не делится на 100', () => {
    const text = formatMoney({ amountCents: 5000, currency: 'JPY' }, 'en');
    expect(text).toContain('5,000');
  });
});
