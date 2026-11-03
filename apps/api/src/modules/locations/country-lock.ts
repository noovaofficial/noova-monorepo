/**
 * Страна анкеты не меняется: цена анкеты лежит в валюте страны без пересчёта,
 * а правила и стоимость размещения привязаны к стране. Переезд в другую
 * страну — это новая анкета.
 *
 * Коды уходят клиенту в `appCode` ответа: текст ошибки по-русски, а
 * интерфейс на пяти языках показывает свой, по коду.
 */
export const COUNTRY_LOCKED = 'country_locked';
export const CITY_HAS_PROFILES = 'city_has_profiles';
export const COMPANY_COUNTRY_LOCKED = 'company_country_locked';

/** Владелец переносит анкету в другой город: можно, пока страна та же. */
export function canMoveProfileToCity(profileCountryId: string, cityCountryId: string): boolean {
  return profileCountryId === cityCountryId;
}

/** Админ переносит город в другую страну: можно, пока в городе нет анкет. */
export function canMoveCityToCountry(
  currentCountryId: string,
  nextCountryId: string | undefined,
  profileCount: number,
): boolean {
  return nextCountryId === undefined || nextCountryId === currentCountryId || profileCount === 0;
}

/** Ошибка HTTP с кодом для интерфейса. */
export function withCode<T extends Error>(error: T, appCode: string): T {
  return Object.assign(error, { appCode });
}
