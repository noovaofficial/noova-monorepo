export const LOCALES = ['de', 'en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

/** Германия — основной рынок, поэтому дефолт немецкий. */
export const DEFAULT_LOCALE: Locale = 'de';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
