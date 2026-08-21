import { z } from 'zod';
import { moneySchema } from './common';

/**
 * Анкета в списке точки на карте. Урезана до опознавательного минимума:
 * карта показывает десятки точек разом, и полная карточка на каждую
 * раздула бы ответ впустую.
 */
export const mapProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  age: z.number().int().nullable(),
  photoUrl: z.string().nullable(),
  fromPrice: moneySchema.nullable(),
  isVerified: z.boolean(),
});
export type MapProfile = z.infer<typeof mapProfileSchema>;

/**
 * Точка на карте — это всегда группа, а не одна анкета.
 *
 * Координаты огрублены до узла сетки (`snapLocation`), поэтому все анкеты
 * одного района или одной ячейки лежат на одинаковых координатах и без
 * группировки совпали бы пиксель в пиксель. Группа с числом честнее:
 * она и показывает плотность, и не создаёт впечатления, что маркер
 * указывает на конкретный дом.
 */
export const mapClusterSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  /** Сколько анкет в этой точке всего — может быть больше, чем в `profiles`. */
  total: z.number().int().positive(),
  /** Первые несколько для показа в карточке точки. */
  profiles: z.array(mapProfileSchema),
});
export type MapCluster = z.infer<typeof mapClusterSchema>;

/** Сколько анкет показывать в карточке точки, не заставляя листать. */
export const MAP_CLUSTER_SAMPLE = 6;
