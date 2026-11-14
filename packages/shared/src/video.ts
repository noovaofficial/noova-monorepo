import { z } from 'zod';

/**
 * Видео анкеты. Одно на анкету, короткое, и только при действующей подписке:
 * без неё нельзя загрузить новое, а уже одобренное не показывается наружу
 * (но не удаляется — возвращается само, когда подписка снова действует).
 */

/** Сколько видео у одной анкеты. */
export const MAX_VIDEOS_PER_PROFILE = 1;
/** Потолок исходного файла. Готовое видео после перекодирования легче. */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Потолок длительности, секунды. */
export const VIDEO_MAX_SECONDS = 30;

export const videoStatusSchema = z.enum(['processing', 'ready', 'failed']);
export type VideoStatus = z.infer<typeof videoStatusSchema>;

/** Видео на публичной странице анкеты — только одобренное и обработанное. */
export const videoSchema = z.object({
  id: z.string(),
  url: z.string(),
  posterUrl: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
});
export type Video = z.infer<typeof videoSchema>;

/**
 * Видео глазами владельца: видно и пока обрабатывается, и до одобрения.
 * Ссылок нет, пока обработка не закончилась, — показывать ещё нечего.
 */
export const ownVideoSchema = z.object({
  id: z.string(),
  status: videoStatusSchema,
  url: z.string().nullable(),
  posterUrl: z.string().nullable(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  isApproved: z.boolean(),
  rejectedReason: z.string().nullable(),
});
export type OwnVideo = z.infer<typeof ownVideoSchema>;

export const ownVideoStateSchema = z.object({
  video: ownVideoSchema.nullable(),
  /**
   * Действует ли подписка владельца. Без неё загрузка закрыта, а одобренное
   * видео скрыто с публичной страницы.
   */
  hasSubscription: z.boolean(),
});
export type OwnVideoState = z.infer<typeof ownVideoStateSchema>;

/**
 * Размер кадра после перекодирования: вписываем в 1280×720 (или 720×1280 для
 * вертикального), не увеличивая. Стороны чётные — этого требует H.264 с
 * yuv420p, нечётный размер кодировщик отвергает.
 */
export function videoTargetSize(width: number, height: number): { width: number; height: number } {
  const LONG = 1280;
  const SHORT = 720;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, LONG / long, SHORT / short);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}
