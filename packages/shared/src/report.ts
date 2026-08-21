import { z } from 'zod';

export const profileReportReasonSchema = z.enum([
  'underage',
  'coercion',
  'stolen_photos',
  'impersonation',
  'illegal_services',
  'spam',
  'other',
]);
export type ProfileReportReason = z.infer<typeof profileReportReasonSchema>;

/**
 * Причины, требующие немедленного разбора. Это не «важнее» в смысле удобства:
 * речь о возможном преступлении, и такая жалоба не должна лежать в общей
 * очереди за десятком сообщений о навязчивой рекламе.
 */
export const URGENT_REPORT_REASONS: readonly ProfileReportReason[] = [
  'underage',
  'coercion',
] as const;

export function isUrgentReason(reason: ProfileReportReason): boolean {
  return URGENT_REPORT_REASONS.includes(reason);
}

/** Порядок в форме: сначала то, о чём важнее всего узнать. */
export const PROFILE_REPORT_REASONS: readonly ProfileReportReason[] = [
  'underage',
  'coercion',
  'stolen_photos',
  'impersonation',
  'illegal_services',
  'spam',
  'other',
] as const;

export const createProfileReportSchema = z.object({
  reason: profileReportReasonSchema,
  /**
   * Пояснение обязательно. Одна категория ничего не даёт модератору:
   * «краденые фото» без указания, чьи и где, проверить нельзя.
   */
  details: z.string().trim().min(10).max(1000),
});
export type CreateProfileReportInput = z.infer<typeof createProfileReportSchema>;

/** Жалоба в очереди модерации. */
export const profileReportItemSchema = z.object({
  kind: z.literal('report'),
  id: z.string(),
  reason: profileReportReasonSchema,
  details: z.string(),
  isUrgent: z.boolean(),
  /** Адрес заявителя, если он входил. Анонимная жалоба — тоже жалоба. */
  reporterEmail: z.string().nullable(),
  createdAt: z.string().datetime(),
  profile: z.object({
    id: z.string(),
    slug: z.string(),
    displayName: z.string(),
    cityName: z.string(),
  }),
  /** Сколько ещё незакрытых жалоб на эту же анкету. */
  otherOpenReports: z.number().int().nonnegative(),
});
export type ProfileReportItem = z.infer<typeof profileReportItemSchema>;
