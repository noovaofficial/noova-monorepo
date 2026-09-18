/**
 * Локация в адресе: `/{locale}/{location}/...`, где `location` — слуг города
 * или код страны в нижнем регистре, «вся страна» без выбранного города (N-42).
 *
 * Городской префикс получают только витринные страницы — главная, каталог и
 * карта. Кабинет, вход, админка и страница анкеты живут без него: анкета
 * привязана к одному городу, и город в её адресе означал бы обязанность
 * вечно редиректить прежний адрес при переезде.
 *
 * Каталог и карта остаются жёстко городскими: у них нет странового среза,
 * только главная умеет показывать анкеты всей страны разом.
 */

import type { CityOption, CountryOption, Locale } from '@noova/shared';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { fetchCities, fetchCountries } from '@/shared/api';

/**
 * Активные города на языке запроса.
 *
 * Ошибку не пропускаем молча наверх пустым списком, как было раньше. Пустой
 * список — правдоподобный ответ («городов пока нет»), и страница с ним
 * попадала в кэш как обычная удачная отрисовка. Хуже всего это выходило на
 * сборке образа: API во время `docker build` недоступен в принципе, и в образ
 * запекалась статическая главная со словами «Городов пока нет». Она и
 * показывалась после каждого выпуска, пока ISR не перерисует страницу.
 *
 * `connection()` переводит отрисовку в режим «по запросу»: на сборке она
 * отменяет предрендер этой страницы, в рантайме — запрещает класть ответ
 * в кэш. Сбой остаётся сбоем на одну отрисовку и не застывает в кэше.
 */
export async function activeCities(locale: Locale): Promise<CityOption[]> {
  try {
    return await fetchCities({ locale, revalidate: 300 });
  } catch {
    await connection();
    return [];
  }
}

/** То же самое для стран — см. `activeCities`. */
export async function activeCountries(locale: Locale): Promise<CountryOption[]> {
  try {
    return await fetchCountries({ locale, revalidate: 300 });
  } catch {
    await connection();
    return [];
  }
}

/**
 * Город из адреса. Неизвестный или отключённый — 404, а не подстановка
 * первого попавшегося: чужая ссылка не должна молча показывать другой город.
 */
export async function requireCity(locale: Locale, slug: string): Promise<CityOption> {
  const city = (await activeCities(locale)).find((item) => item.slug === slug);
  if (!city) notFound();
  return city;
}

export type ResolvedLocation =
  | { type: 'city'; city: CityOption }
  | { type: 'country'; country: CountryOption };

/**
 * Второй сегмент адреса — город или страна целиком. Город проверяется
 * первым: совпадений со слугом страны быть не должно (см.
 * `citySlugCollidesWithCountry` в админке), но порядок снимает сам вопрос.
 */
export async function requireLocation(locale: Locale, slug: string): Promise<ResolvedLocation> {
  const [cities, countries] = await Promise.all([activeCities(locale), activeCountries(locale)]);

  const city = cities.find((item) => item.slug === slug);
  if (city) return { type: 'city', city };

  const country = countries.find((item) => item.code.toLowerCase() === slug.toLowerCase());
  if (country) return { type: 'country', country };

  notFound();
}

/**
 * Куда вести с адреса без города (N-42).
 *
 * Cookie `noova_location` (проставляется в `proxy.ts`) хранит последний
 * посещённый сегмент как есть, не различая город и страну, — здесь он
 * сверяется со справочником и по надобности отбрасывается: удалённый или
 * отключённый город не должен уводить обратно на несуществующую страницу.
 * Нет валидной cookie — редирект на страну по умолчанию, а не на список для
 * ручного выбора: сам список больше нигде не рендерится.
 *
 * Возвращается (без редиректа), только если географии нет вовсе — пустая
 * или не засеянная база. Рендер этого случая — на вызывающей стороне,
 * здесь нечего показывать.
 */
export async function resolveHome(locale: Locale, remembered: string | undefined): Promise<void> {
  const [cities, countries] = await Promise.all([activeCities(locale), activeCountries(locale)]);

  const rememberedCity = remembered && cities.find((item) => item.slug === remembered);
  if (rememberedCity) redirect(`/${locale}/${rememberedCity.slug}`);

  const rememberedCountry =
    remembered && countries.find((item) => item.code.toLowerCase() === remembered.toLowerCase());
  if (rememberedCountry) redirect(`/${locale}/${rememberedCountry.code.toLowerCase()}`);

  const defaultCountry = countries.find((item) => item.isDefault) ?? countries[0];
  if (defaultCountry) redirect(`/${locale}/${defaultCountry.code.toLowerCase()}`);
}
