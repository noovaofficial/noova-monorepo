import type { CityOption, CountryOption } from '@noova/shared';

export type CurrentLocation = {
  country: CountryOption;
  /** Нет — открыта вся страна целиком. */
  city: CityOption | null;
  /** Хвост пути после локации (`/catalog/escort`), чтобы выбор места не терял страницу. */
  rest: string[];
};

/**
 * Локация из адреса (`/berlin/catalog/escort`, `/nl`) — город или код страны.
 * `pathname` без языкового префикса: его снимает обёртка next-intl. Вне
 * витрины (анкета, кабинет, админка) возвращает null.
 */
export function currentLocation(
  pathname: string,
  cities: CityOption[],
  countries: CountryOption[],
): CurrentLocation | null {
  const [, first = '', ...rest] = pathname.split('/');
  const city = cities.find((item) => item.slug === first) ?? null;
  const country = city
    ? countries.find((item) => item.code === city.country.code)
    : countries.find((item) => item.code.toLowerCase() === first.toLowerCase());
  return country ? { country, city, rest } : null;
}

/** Слуг для адреса: город или код страны в нижнем регистре. */
export const locationSlug = (country: CountryOption, city: CityOption | null): string =>
  city ? city.slug : country.code.toLowerCase();
