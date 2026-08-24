import { LOCALES } from '@noova/shared';
import type { MetadataRoute } from 'next';
import { fetchCities, fetchProfiles, safely } from '@/shared/api';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Sitemap строится из живых данных, поэтому обновляем его раз в час. */
export const revalidate = 3600;

function alternates(path: string) {
  return {
    languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`])),
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Только существующие страницы. Правовые появятся вместе с L-01, страница
  // о верификации — вместе с L-02; ссылка в sitemap на 404 хуже её отсутствия.
  //
  // Городского префикса здесь нет: выбор города, «Компания» и контакты одни
  // на весь каталог (N-32).
  const staticPaths = ['', '/about', '/advertising', '/contact'];

  const entries: MetadataRoute.Sitemap = LOCALES.flatMap((locale) =>
    staticPaths.map((path) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: new Date(),
      changeFrequency: path === '' ? ('hourly' as const) : ('monthly' as const),
      priority: path === '' ? 1 : 0.5,
      alternates: alternates(path),
    })),
  );

  // Витринные страницы умножаются на города: главная города и два каталога.
  // Карта в sitemap не идёт — то же содержимое другим представлением.
  const cities = await safely(fetchCities({ revalidate: 3600 }), [], 'sitemapCities');
  for (const city of cities) {
    for (const path of ['', '/catalog/escort', '/catalog/massage']) {
      const full = `/${city.slug}${path}`;
      entries.push(
        ...LOCALES.map((locale) => ({
          url: `${SITE_URL}/${locale}${full}`,
          lastModified: new Date(),
          changeFrequency: 'hourly' as const,
          priority: path === '' ? 0.9 : 0.8,
          alternates: alternates(full),
        })),
      );
    }
  }

  // Анкеты подтягиваем из API. Если бэк недоступен, отдаём хотя бы статические
  // маршруты — пустой sitemap хуже неполного.
  try {
    for (const kind of ['escort', 'massage'] as const) {
      const page = await fetchProfiles({ kind, limit: 60 }, { revalidate: 3600 });
      for (const profile of page.items) {
        const path = `/profile/${profile.slug}`;
        entries.push(
          ...LOCALES.map((locale) => ({
            url: `${SITE_URL}/${locale}${path}`,
            lastModified: new Date(),
            changeFrequency: 'daily' as const,
            priority: profile.isFeatured ? 0.9 : 0.7,
            alternates: alternates(path),
          })),
        );
      }
    }
  } catch {
    // осознанно проглатываем: sitemap не должен падать из-за недоступного API
  }

  return entries;
}
