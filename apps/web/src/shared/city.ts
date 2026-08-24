/**
 * Город в адресе: `/{locale}/{city}/...` (N-32).
 *
 * Городской префикс получают только витринные страницы — главная, каталог и
 * карта. Кабинет, вход, админка и страница анкеты живут без него: анкета
 * привязана к одному городу, и город в её адресе означал бы обязанность
 * вечно редиректить прежний адрес при переезде.
 */

import type { CityOption, Locale } from '@noova/shared';
import { notFound, redirect } from 'next/navigation';
import { fetchCities } from '@/shared/api';

/** Активные города на языке запроса. Пустой список — API недоступен. */
export async function activeCities(locale: Locale): Promise<CityOption[]> {
  try {
    return await fetchCities({ locale, revalidate: 300 });
  } catch {
    // Каталог городов не должен ронять страницу целиком: без него она
    // отрисуется как «город не найден», а ISR подтянет данные позже.
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

/**
 * Куда вести с адреса без города.
 *
 * Один активный город — редирект на него: страница выбора из одного пункта
 * бессмысленна. Несколько — показываем выбор. Правило само подстраивается
 * под рост каталога, и отдельного поля «город по умолчанию» не требует.
 */
export async function redirectToSingleCity(locale: Locale): Promise<CityOption[]> {
  const cities = await activeCities(locale);
  if (cities.length === 1 && cities[0]) redirect(`/${locale}/${cities[0].slug}`);
  return cities;
}
