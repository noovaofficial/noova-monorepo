import { describe, expect, it } from 'vitest';
import { canMoveCityToCountry, canMoveProfileToCity, withCode } from './country-lock.js';

describe('запрет смены страны', () => {
  it('анкету можно перенести в другой город только в пределах страны', () => {
    expect(canMoveProfileToCity('de', 'de')).toBe(true);
    expect(canMoveProfileToCity('de', 'nl')).toBe(false);
  });

  it('город с анкетами в другую страну не переносится', () => {
    expect(canMoveCityToCountry('de', 'nl', 3)).toBe(false);
  });

  it('пустой город перенести можно', () => {
    expect(canMoveCityToCountry('de', 'nl', 0)).toBe(true);
  });

  it('правка города без смены страны не блокируется анкетами', () => {
    expect(canMoveCityToCountry('de', 'de', 10)).toBe(true);
    expect(canMoveCityToCountry('de', undefined, 10)).toBe(true);
  });

  it('код ошибки прикрепляется к исключению', () => {
    const error = withCode(new Error('x'), 'country_locked');
    expect((error as Error & { appCode?: string }).appCode).toBe('country_locked');
  });
});
