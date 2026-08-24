import { z } from 'zod';
import { commentQueueItemSchema } from './comment';
import { listingKindSchema, verificationStatusSchema } from './profile';
import { profileReportItemSchema } from './report';

export const moderationSubjectSchema = z.enum([
  'photo',
  'profile',
  'verification',
  'comment',
  'user',
]);
export type ModerationSubject = z.infer<typeof moderationSubjectSchema>;

export const moderationDecisionSchema = z.enum(['approved', 'rejected']);
export type ModerationDecision = z.infer<typeof moderationDecisionSchema>;

/** Причина отказа видна владельцу анкеты, поэтому она обязательна и осмысленна. */
export const rejectionSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

/** Анкета в контексте очереди: кого именно проверяет модератор. */
const queueProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  kind: listingKindSchema,
  cityName: z.string(),
});

export const photoQueueItemSchema = z.object({
  kind: z.literal('photo'),
  id: z.string(),
  /** Подписанная ссылка: неодобренное фото недоступно публично. */
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.string().datetime(),
  profile: queueProfileSchema,
});
export type PhotoQueueItem = z.infer<typeof photoQueueItemSchema>;

export const verificationQueueItemSchema = z.object({
  kind: z.literal('verification'),
  id: z.string(),
  submittedAt: z.string().datetime().nullable(),
  ageConfirmed: z.boolean(),
  identityConfirmed: z.boolean(),
  photoCount: z.number().int().nonnegative(),
  profile: queueProfileSchema,
});
export type VerificationQueueItem = z.infer<typeof verificationQueueItemSchema>;

export const queueItemSchema = z.discriminatedUnion('kind', [
  photoQueueItemSchema,
  verificationQueueItemSchema,
  commentQueueItemSchema,
  profileReportItemSchema,
]);
export type QueueItem = z.infer<typeof queueItemSchema>;

export const queueCountSchema = z.object({
  photos: z.number().int().nonnegative(),
  verifications: z.number().int().nonnegative(),
  /** Ожидающие проверки комментарии плюс жалобы на уже опубликованные. */
  comments: z.number().int().nonnegative(),
  /** Незакрытые жалобы на анкеты. */
  reports: z.number().int().nonnegative(),
  /** Из них срочные: несовершеннолетняя или принуждение. */
  urgentReports: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type QueueCount = z.infer<typeof queueCountSchema>;

/**
 * Анкета глазами модератора. Отличается от публичной тем, что доступна
 * в любом статусе и показывает неодобренные фото по подписанным ссылкам:
 * без этого проверять нечего — модератор не видит того, что одобряет.
 */
/**
 * Заблокированная анкета в списке. Отдельная схема, а не полное представление
 * анкеты: в таблице нужны причина, дата и владелец, а не тарифы и услуги.
 */
export const blockedProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  cityName: z.string(),
  kind: listingKindSchema,
  /** Причина блокировки: без неё непонятно, за что и можно ли снимать. */
  reason: z.string().nullable(),
  ownerEmail: z.string(),
  /** Заблокирована ли ещё и учётная запись владельца — это разные меры. */
  isOwnerBlocked: z.boolean(),
  blockedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type BlockedProfile = z.infer<typeof blockedProfileSchema>;

export const moderatedProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  status: z.string(),
  kind: listingKindSchema,
  displayName: z.string(),
  description: z.string(),
  cityName: z.string(),
  districtName: z.string().nullable(),
  age: z.number().int().nullable(),
  heightCm: z.number().int().nullable(),
  weightKg: z.number().int().nullable(),
  languages: z.array(z.string()),
  /** Ключ для журналов, название — для показа модератору (N-35). */
  services: z.array(z.object({ key: z.string(), name: z.string() })),
  prices: z.array(
    z.object({
      durationMinutes: z.number().int(),
      incallCents: z.number().int().nullable(),
      outcallCents: z.number().int().nullable(),
    }),
  ),
  photos: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      isApproved: z.boolean(),
      rejectedReason: z.string().nullable(),
    }),
  ),
  verificationStatus: verificationStatusSchema,
  owner: z.object({ email: z.string(), advertiserKind: z.string().nullable() }),
  createdAt: z.string().datetime(),
});
export type ModeratedProfile = z.infer<typeof moderatedProfileSchema>;

// ---------- Пользователи ----------

export const managedUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(['client', 'advertiser', 'moderator', 'admin']),
  isEmailVerified: z.boolean(),
  isBlocked: z.boolean(),
  /** Причина блокировки. Заполнена ровно тогда, когда `isBlocked`. */
  banReason: z.string().nullable(),
  bannedAt: z.string().datetime().nullable(),
  nickname: z.string().nullable(),
  profileCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;

export const userSearchSchema = z.object({
  query: z.string().trim().max(254).optional(),
  /** Только заблокированные — для отдельной таблицы, а не фильтра в поиске. */
  blocked: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

/**
 * Причина блокировки. Обязательна: блокировка без объяснения не оставляет
 * человеку способа исправиться и превращает модерацию в произвол.
 */
export const blockSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type BlockInput = z.infer<typeof blockSchema>;

// ---------- Управление персоналом ----------

export const staffRoleSchema = z.enum(['moderator', 'admin']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const staffMemberSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: staffRoleSchema,
  isBlocked: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  /** Сколько решений принял — видно, кто реально работает. */
  decisionCount: z.number().int().nonnegative(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

/**
 * Запись журнала. Существует, чтобы при споре с владельцем анкеты или запросе
 * надзорного органа было видно, кто и на каком основании принял решение.
 */
/**
 * Предмет решения, раскрытый сервером. Голый `subjectId` — это id фото,
 * заявки, отзыва или пользователя; собирать из него ссылку на клиенте значило
 * бы зашить туда знание о четырёх разных таблицах.
 *
 * `null` — предмет больше не существует: фото вычищено по сроку хранения
 * (N-18), учётка удалена. Строка журнала при этом остаётся: он о том, что
 * решение было принято, а не о том, что предмет жив.
 */
export const moderationSubjectRefSchema = z.object({
  /** Что показать в строке: имя анкеты, адрес почты, начало текста отзыва. */
  title: z.string(),
  /** Кого решение касалось: владелица анкеты или автор отзыва. */
  accountEmail: z.string().nullable(),
  /** Id анкеты для перехода в просмотр модератора. Null — открывать нечего. */
  profileId: z.string().nullable(),
  cityName: z.string().nullable(),
});
export type ModerationSubjectRef = z.infer<typeof moderationSubjectRefSchema>;

export const moderationLogEntrySchema = z.object({
  id: z.string(),
  moderatorEmail: z.string(),
  moderatorId: z.string(),
  subjectType: moderationSubjectSchema,
  subjectId: z.string(),
  /** Null — предмет удалён; строка остаётся с пометкой. */
  subject: moderationSubjectRefSchema.nullable(),
  decision: moderationDecisionSchema,
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ModerationLogEntry = z.infer<typeof moderationLogEntrySchema>;

export const moderationLogQuerySchema = z.object({
  moderatorId: z.string().optional(),
  subjectType: moderationSubjectSchema.optional(),
  decision: moderationDecisionSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
  role: staffRoleSchema,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
