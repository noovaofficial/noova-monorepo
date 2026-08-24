/**
 * Справочник географии: страны, города, районы (N-32).
 *
 * Заводится только главным администратором. Модератору сюда нельзя: состав
 * стран определяет, в каких юрисдикциях работает площадка, и это решение
 * владельца, а не оператора очереди.
 */
import { z } from 'zod';
import { slugSchema } from './common';
import { translatedSchema } from './locales';

/**
 * Слуги, которые город занять не может.
 *
 * Город — второй сегмент после языка (`/{locale}/{city}/...`), и он делит
 * это место со статическими маршрутами: `/ru/about` и `/ru/berlin` неотличимы
 * по форме. Next разрешает конфликт в пользу статического маршрута, поэтому
 * город с таким именем просто не откроется — молча, без ошибки при заведении.
 *
 * Список сверяется с содержимым `apps/web/src/app/[locale]` тестом: маршрут,
 * добавленный без обновления этого списка, уронит сборку, а не выяснится
 * потом на проде.
 */
export const RESERVED_CITY_SLUGS = [
  'about',
  'account',
  'admin',
  'advertising',
  'catalog',
  'contact',
  'login',
  'moderation',
  'profile',
  'register',
  'reset-password',
  'verify-email',
] as const;

export const citySlugSchema = slugSchema.refine(
  (value) => !(RESERVED_CITY_SLUGS as readonly string[]).includes(value),
  { message: 'Этот адрес занят страницей сайта — выберите другой' },
);

export const countryInputSchema = z.object({
  /** ISO 3166-1 alpha-2, в верхнем регистре. */
  code: z
    .string()
    .length(2)
    .transform((value) => value.toUpperCase()),
  name: translatedSchema,
  isActive: z.boolean().default(true),
});
export type CountryInput = z.infer<typeof countryInputSchema>;

export const countrySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: translatedSchema,
  isActive: z.boolean(),
  cityCount: z.number().int().nonnegative(),
});
export type Country = z.infer<typeof countrySchema>;

export const districtInputSchema = z.object({
  slug: slugSchema,
  name: translatedSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isActive: z.boolean().default(true),
});
export type DistrictInput = z.infer<typeof districtInputSchema>;

export const cityInputSchema = z.object({
  slug: citySlugSchema,
  name: translatedSchema,
  countryId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isActive: z.boolean().default(true),
  /**
   * Районы необязательны: не в каждом городе они осмысленны. Анкета без
   * района получает координату центра города — грубее, а значит приватнее.
   */
  districts: z.array(districtInputSchema).default([]),
});
export type CityInput = z.infer<typeof cityInputSchema>;

export const districtSchema = districtInputSchema.extend({
  id: z.string(),
  profileCount: z.number().int().nonnegative(),
});
export type District = z.infer<typeof districtSchema>;

export const citySchemaAdmin = z.object({
  id: z.string(),
  slug: z.string(),
  name: translatedSchema,
  countryId: z.string(),
  countryCode: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isActive: z.boolean(),
  profileCount: z.number().int().nonnegative(),
  districts: z.array(districtSchema),
});
export type CityAdmin = z.infer<typeof citySchemaAdmin>;
