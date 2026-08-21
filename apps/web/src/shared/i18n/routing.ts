import { DEFAULT_LOCALE, LOCALES } from '@noova/shared';
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // 'always' — у каждого языка свой URL (/de, /en, /ru). Это нужно для hreflang
  // и раздельной индексации: без префикса поисковик видит одну страницу на все языки.
  localePrefix: 'always',
});
