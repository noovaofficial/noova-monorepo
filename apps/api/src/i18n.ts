/**
 * Язык ответа. Названия справочников хранятся в БД переводами (N-35), и
 * выбрать нужный может только тот, кто знает язык запроса, — то есть API.
 *
 * Локаль приходит параметром запроса, а не заголовком `Accept-Language`:
 * фронт кэширует ответы через ISR по адресу, и невидимый в адресе заголовок
 * сделал бы разные языки одной записью кэша.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from '@noova/shared';
import { z } from 'zod';

export const localeQuerySchema = z.object({
  locale: z
    .string()
    .optional()
    .transform((value) => (value && isLocale(value) ? value : DEFAULT_LOCALE)),
});

/** Выборка перевода одной локали — подставляется в `select` Prisma. */
export const translationSelect = (locale: Locale) => ({
  where: { locale },
  select: { name: true },
});

/**
 * Название на нужном языке.
 *
 * Запись без перевода появиться неоткуда: контракт `translatedSchema` не даёт
 * сохранить неполный набор. Но если она всё же есть, отдать техническое имя
 * честнее, чем уронить весь каталог пятисоткой из-за одной строки: посетитель
 * увидит немецкое название, а не пустую страницу.
 */
export function localized(translations: { name: string }[] | undefined, fallback: string): string {
  return translations?.[0]?.name ?? fallback;
}
