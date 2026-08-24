import type { Locale } from '@noova/shared';
import { permanentRedirect } from 'next/navigation';
import { activeCities } from '@/shared/city';

/**
 * Прежний адрес карты каталога, без города.
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
};

export default async function LegacyCatalogMapRedirect({ params }: Props) {
  const { locale, kind } = await params;
  const cities = await activeCities(locale);
  const city = cities[0];

  // Городов нет вовсе — вести некуда, кроме выбора города.
  permanentRedirect(city ? `/${locale}/${city.slug}/catalog/${kind}/map` : `/${locale}`);
}
