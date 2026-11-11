import type { CityOption, CountryOption } from '@noova/shared';
import { describe, expect, it } from 'vitest';
import { currentLocation } from './current-location';

const countries: CountryOption[] = [
  { code: 'DE', name: 'Germany', isDefault: true, currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', isDefault: false, currency: 'EUR' },
];
const cities: CityOption[] = [
  { slug: 'berlin', name: 'Berlin', country: { code: 'DE', name: 'Germany' }, districts: [] },
];

describe('локация из адреса', () => {
  it('город даёт и страну', () => {
    const found = currentLocation('/berlin/catalog/escort', cities, countries);
    expect(found?.city?.slug).toBe('berlin');
    expect(found?.country.code).toBe('DE');
    expect(found?.rest).toEqual(['catalog', 'escort']);
  });

  it('код страны — вся страна без города', () => {
    const found = currentLocation('/nl', cities, countries);
    expect(found?.city).toBeNull();
    expect(found?.country.code).toBe('NL');
  });

  it('вне витрины локации нет', () => {
    expect(currentLocation('/account/profiles', cities, countries)).toBeNull();
    expect(currentLocation('/profile/anna', cities, countries)).toBeNull();
  });
});
