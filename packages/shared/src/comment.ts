import { z } from 'zod';

export const commentStatusSchema = z.enum(['pending', 'published', 'rejected', 'hidden']);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

/** Не чаще одного комментария на анкету в сутки от одного человека. */
export const COMMENT_COOLDOWN_HOURS = 24;

export const COMMENT_MAX_LENGTH = 2000;

/**
 * Комментарий в публичном списке. Автор — только никнейм: настоящее имя
 * клиента наружу не отдаётся, а идентификатор учётной записи позволил бы
 * связать высказывания одного человека по разным анкетам.
 *
 * Полей, зависящих от того, кто смотрит, здесь нет намеренно: этот список
 * отдаётся страницей анкеты и кэшируется ISR. Подмешай сюда «можно ли
 * пожаловаться» — и в кэш попал бы ответ, посчитанный для случайного
 * посетителя.
 */
export const profileCommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  authorNickname: z.string(),
  createdAt: z.string().datetime(),
});
export type ProfileComment = z.infer<typeof profileCommentSchema>;

/**
 * Собственный комментарий автора — отдельным запросом из браузера.
 * Автор должен видеть его и до публикации: без пометки «на проверке»
 * кажется, что форма не сработала.
 */
export const ownCommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  status: commentStatusSchema,
  /** Причина отказа: автор должен понимать, почему комментарий не вышел. */
  moderationNote: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type OwnComment = z.infer<typeof ownCommentSchema>;

/**
 * Тело комментария. Разметки нет: ни ссылок, ни HTML — только текст.
 * Экранирование при выводе делает React, но пускать сюда разметку незачем
 * и в принципе — комментарии о живых людях не место для активного содержимого.
 */
export const createCommentSchema = z.object({
  body: z.string().trim().min(10).max(COMMENT_MAX_LENGTH),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const reportCommentSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});
export type ReportCommentInput = z.infer<typeof reportCommentSchema>;

/** Комментарий в очереди модерации: вместе с анкетой и жалобами на него. */
export const commentQueueItemSchema = z.object({
  kind: z.literal('comment'),
  id: z.string(),
  body: z.string(),
  status: commentStatusSchema,
  authorNickname: z.string(),
  createdAt: z.string().datetime(),
  profile: z.object({
    id: z.string(),
    slug: z.string(),
    displayName: z.string(),
    cityName: z.string(),
  }),
  /** Жалобы на этот комментарий. Пустой список — обычный новый комментарий. */
  reports: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});
export type CommentQueueItem = z.infer<typeof commentQueueItemSchema>;
