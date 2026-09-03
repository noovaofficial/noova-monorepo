import { z } from 'zod';

/**
 * Языки интерфейса. Порядок задан владельцем продукта и виден человеку: по
 * нему строится переключатель языка в шапке.
 *
 * Он же порядок ключей в словарях и в справочниках — сверять переводы
 * приходится глазами, и разный порядок превращает сравнение в кашу.
 */
export const LOCALES = ['en', 'de', 'es', 'fr', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

/** Германия — основной рынок, поэтому дефолт немецкий. */
export const DEFAULT_LOCALE: Locale = 'de';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Перевод названия справочника: строка на каждую локаль, без исключений.
 *
 * Полнота — требование владельца продукта, а не удобство. Схема с
 * необязательными полями допустила бы запись, у которой русского названия
 * нет, и посетитель на русском увидел бы немецкое слово, приняв его за
 * поломку сайта. Здесь такая запись просто не проходит разбор — ни из
 * админки, ни из сида.
 *
 * Объявлено через `z.object` по списку LOCALES, а не `z.record`: record
 * не отличает «нет ключа» от «ключей вообще нет».
 */
export const translatedSchema = z.object(
  Object.fromEntries(LOCALES.map((locale) => [locale, z.string().trim().min(1)])) as {
    [K in Locale]: z.ZodString;
  },
);
export type Translated = z.infer<typeof translatedSchema>;

/** Строки переводов, как они лежат в БД, — в объект по локалям. */
export function toTranslated(rows: { locale: string; name: string }[]): Translated | null {
  const byLocale = new Map(rows.map((r) => [r.locale, r.name]));
  const result = {} as Record<Locale, string>;
  for (const locale of LOCALES) {
    const value = byLocale.get(locale);
    // Неполный набор — не повод подставлять запасное значение: он означает,
    // что данные попали в базу мимо контракта, и молчаливая подмена спрячет
    // это до момента, когда виноватого уже не найти.
    if (!value) return null;
    result[locale] = value;
  }
  return result;
}

/**
 * Название на языке интерфейса. Локаль приходит строкой из роутера, поэтому
 * проверяется; незнакомая — дефолт, а не пустая строка.
 */
export function pickTranslation(name: Translated, locale: string): string {
  return name[isLocale(locale) ? locale : DEFAULT_LOCALE];
}
