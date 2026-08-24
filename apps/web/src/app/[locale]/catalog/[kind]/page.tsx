import type { Locale } from '@noova/shared';
import { permanentRedirect } from 'next/navigation';
import { activeCities } from '@/shared/city';

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
  const cities = await activeCities(locale);
  const city = cities[0];

  // Фильтры переносим вместе с адресом: старая ссылка с выбранными услугами
  // иначе привела бы в пустой каталог, и потеря выглядела бы как сброс.
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) for (const item of value) search.append(key, item);
    else if (value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  const suffix = query ? `?${query}` : '';

  // Городов нет вовсе — вести некуда, кроме выбора города.
  permanentRedirect(city ? `/${locale}/${city.slug}/catalog/${kind}${suffix}` : `/${locale}`);
}
