import { z } from 'zod';
import { profileCardSchema } from './profile';

/**
 * Карточка в избранном. Отличается от каталожной одним полем: анкету могли
 * снять с публикации уже после того, как её отметили. Молча пропавшая
 * карточка выглядит как поломка — поэтому она остаётся в списке с пометкой,
 * а решение убрать её принимает клиент.
 */
export const favoriteItemSchema = z.object({
  profile: profileCardSchema,
  addedAt: z.string().datetime(),
  /** Анкета всё ещё опубликована. False — снята, приостановлена или забанена. */
  isAvailable: z.boolean(),
});
export type FavoriteItem = z.infer<typeof favoriteItemSchema>;

/**
 * Только идентификаторы — для состояния сердец на карточках. Отдельно от
 * полного списка: страница каталога показывает два десятка карточек, и
 * тянуть ради подсветки два десятка полных карточек незачем.
 */
export const favoriteIdsSchema = z.object({
  ids: z.array(z.string()),
});
export type FavoriteIds = z.infer<typeof favoriteIdsSchema>;
