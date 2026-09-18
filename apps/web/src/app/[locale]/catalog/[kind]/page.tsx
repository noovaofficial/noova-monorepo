import type { Locale } from '@noova/shared';
import { permanentRedirect } from 'next/navigation';
import { activeCities, activeCountries } from '@/shared/city';

/**
 * Прежний адрес каталога, без города: `/{locale}/catalog/{kind}`.
 *
 * Каталог переехал под городской префикс (N-32), но ссылки на старый адрес
 * уже существуют — во внешних источниках и в выдаче. Отдаём постоянный
 * редирект, а не 404: 301 переносит вес страницы на новый адрес, 404 его
 * теряет.
 *
 * Каталог заодно остаётся в `RESERVED_CITY_SLUGS`: город с таким слугом
 * перекрылся бы этим маршрутом.
 */
type Props = {
  params: Promise<{ locale: Locale; kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyCatalogRedirect({ params, searchParams }: Props) {
  const { locale, kind } = await params;
  const [cities, countries] = await Promise.all([activeCities(locale), activeCountries(locale)]);

  // Фильтры переносим вместе с адресом: старая ссылка с выбранными услугами
  // иначе привела бы в пустой каталог, и потеря выглядела бы как сброс.
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) for (const item of value) search.append(key, item);
    else if (value !== undefined) search.set(key, value);
  }

  // До переезда город задавался параметром `?city=`. Если он указывал на
  // настоящий город — ведём туда же, куда вела бы старая ссылка. Из строки
  // запроса параметр убираем — теперь город живёт в адресе, а каталог
  // его оттуда и берёт.
  //
  // Без параметра (или с незнакомым значением) — каталог страны по
  // умолчанию целиком (N-43), а не какой-то один её город: у каталога
  // теперь есть собственный срез «вся страна», гадать конкретный город
  // незачем.
  const asked = search.get('city');
  const city = cities.find((item) => item.slug === asked);
  if (asked) search.delete('city');
  const query = search.toString();
  const suffix = query ? `?${query}` : '';

  const defaultCountry = countries.find((item) => item.isDefault) ?? countries[0];
  const target = city ? city.slug : defaultCountry ? defaultCountry.code.toLowerCase() : null;

  // Ни городов, ни стран нет вовсе — вести некуда, кроме корня.
  permanentRedirect(target ? `/${locale}/${target}/catalog/${kind}${suffix}` : `/${locale}`);
}
