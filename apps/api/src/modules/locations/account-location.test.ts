import { describe, expect, it } from 'vitest';
import { locationProblem } from './account-location.js';

const de = { id: 'de', isActive: true };
const berlin = { id: 'ber', countryId: 'de', isActive: true };

const base = {
  kind: 'individual',
  country: de,
  city: berlin,
  citySlug: 'berlin',
  allowed: true,
} as const;

describe('место аккаунта при регистрации', () => {
  it('открытая страна и город внутри неё — можно', () => {
    expect(locationProblem(base)).toBeNull();
  });

  it('закрытая для типа страна запрещает регистрацию', () => {
    expect(locationProblem({ ...base, allowed: false })).toBe('placement_forbidden');
  });

  it('неизвестная или отключённая страна не принимается', () => {
    expect(locationProblem({ ...base, country: null })).toBe('country_not_found');
    expect(locationProblem({ ...base, country: { ...de, isActive: false } })).toBe(
      'country_not_found',
    );
  });

  it('город другой страны или отключённый не принимается', () => {
    expect(locationProblem({ ...base, city: { ...berlin, countryId: 'nl' } })).toBe(
      'city_not_found',
    );
    expect(locationProblem({ ...base, city: { ...berlin, isActive: false } })).toBe(
      'city_not_found',
    );
  });

  it('индивидуалке и салону город обязателен, агентству — нет', () => {
    expect(locationProblem({ ...base, citySlug: null, city: null })).toBe('city_required');
    expect(locationProblem({ ...base, kind: 'salon', citySlug: undefined, city: null })).toBe(
      'city_required',
    );
    expect(locationProblem({ ...base, kind: 'agency', citySlug: null, city: null })).toBeNull();
  });
});
