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
import { connection } from 'next/server';
import { fetchCities } from '@/shared/api';

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
