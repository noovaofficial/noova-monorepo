import { LOCALES } from '@noova/shared';
import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Личный кабинет и служебные маршруты индексировать нечего.
        disallow: [
          '/api/',
          ...LOCALES.flatMap((l) => [
            `/${l}/account/`,
            `/${l}/verify/`,
            `/${l}/moderation`,
            `/${l}/admin`,
          ]),
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
