import { z } from 'zod';
import { advertiserKindSchema } from './account';
import { userRoleSchema } from './auth';
import { commentQueueItemSchema } from './comment';
import { slugSchema } from './common';
import { listingKindSchema, verificationStatusSchema } from './profile';
import { profileReportItemSchema } from './report';

export const moderationSubjectSchema = z.enum([
  'photo',
  'profile',
  'verification',
  'identity',
  'comment',
  'user',
  'company',
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
  /** Тот же снимок в полном размере — для просмотра во весь экран. */
  fullUrl: z.string(),
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

/** Очередь листается курсором: у неё четыре источника, и курсор несёт
 *  ещё и вид, с которого продолжать. Клиент его не разбирает. */
export const queueQuerySchema = z.object({
  kind: z.enum(['photo', 'verification', 'comment', 'report']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type QueueQuery = z.infer<typeof queueQuerySchema>;

export const queueCountSchema = z.object({
  photos: z.number().int().nonnegative(),
  verifications: z.number().int().nonnegative(),
  /** Заявки на верификацию личности, ждущие решения (D-12). */
  identity: z.number().int().nonnegative(),
  /** Ожидающие проверки комментарии плюс жалобы на уже опубликованные. */
  comments: z.number().int().nonnegative(),
  /** Незакрытые жалобы на анкеты. */
  reports: z.number().int().nonnegative(),
  /** Из них срочные: несовершеннолетняя или принуждение. */
  urgentReports: z.number().int().nonnegative(),
  /** Заблокированные анкеты — справка для вкладки, в `total` не входят. */
  blockedProfiles: z.number().int().nonnegative(),
  /** Заблокированные пользователи — справка для вкладки, в `total` не входят. */
  blockedUsers: z.number().int().nonnegative(),
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
      fullUrl: z.string(),
      isApproved: z.boolean(),
      rejectedReason: z.string().nullable(),
    }),
  ),
  verificationStatus: verificationStatusSchema,
  owner: z.object({
    id: z.string(),
    email: z.string(),
    advertiserKind: z.string().nullable(),
    glowcoinBalance: z.number().int().nonnegative(),
    /** Ниже — для объединённой карточки анкеты в модерации: те же детали
     *  аккаунта, что и на карточке пользователя (`ManagedUserDetail`), чтобы
     *  не уходить на отдельную страницу за ролью/почтой/датами. */
    role: userRoleSchema,
    isEmailVerified: z.boolean(),
    createdAt: z.string().datetime(),
    lastLoginAt: z.string().datetime().nullable(),
    locale: z.string(),
  }),
  /** Анкета агентства — принадлежит аккаунту агентства целиком (N-31): его
   *  нельзя удалять с этой страницы, не увидев, что у него есть другие анкеты. */
  companyId: z.string().nullable(),
  /** Оплаченное или выданное место в ТОПе прямо сейчас (payments.md §3.4). */
  isFeatured: z.boolean(),
  topExpiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ModeratedProfile = z.infer<typeof moderatedProfileSchema>;

// ---------- Пользователи ----------

/** Единственная анкета индивидуалки/салона — под быстрые действия из списка
 *  (payments.md §3.4). `null`, если её ещё нет или тип рекламодателя другой. */
const managedUserProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  status: z.string(),
  isFeatured: z.boolean(),
  topExpiresAt: z.string().datetime().nullable(),
});

/** Компания агентства — под быстрые действия из списка. `null`, если её ещё
 *  нет или тип рекламодателя другой. */
const managedUserCompanySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  isBanned: z.boolean(),
  banReason: z.string().nullable(),
  isFeatured: z.boolean(),
  topExpiresAt: z.string().datetime().nullable(),
});

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
  /** Баланс GlowCoin — админ видит его перед корректировкой. У клиента и персонала ноль. */
  glowcoinBalance: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  /** Заполнено только для `role: 'advertiser'`. */
  advertiserKind: advertiserKindSchema.nullable(),
  profile: managedUserProfileSchema.nullable(),
  company: managedUserCompanySchema.nullable(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;

export const userSearchSchema = z.object({
  query: z.string().trim().max(254).optional(),
  /** Только заблокированные — для отдельной таблицы, а не фильтра в поиске. */
  blocked: z.enum(['true']).optional(),
  /** Тип учётной записи. Пусто — все: у раздела «Все пользователи» это норма. */
  role: userRoleSchema.optional(),
  /** Раздел People по типу рекламодателя: Agencies/Individuals/Massage salons. */
  advertiserKind: advertiserKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().optional(),
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
  /** Null — сотрудник удалён; запись о его решении остаётся (доказательство). */
  moderatorEmail: z.string().nullable(),
  moderatorId: z.string().nullable(),
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
  cursor: z.string().optional(),
});

export const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
  role: staffRoleSchema,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const blockedProfilesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- Верификация личности (D-12) --------------------------------------------

/** Три снимка: лицо, документ, лицо вместе с документом. Порядок — как в форме. */
export const VERIFICATION_PHOTO_KINDS = ['face', 'document', 'together'] as const;
export type VerificationPhotoKind = (typeof VERIFICATION_PHOTO_KINDS)[number];
export const verificationPhotoKindSchema = z.enum(VERIFICATION_PHOTO_KINDS);

export const verificationRequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type VerificationRequestStatus = z.infer<typeof verificationRequestStatusSchema>;

/** Что видит владелица анкеты о своей заявке. Снимков здесь нет: свои
 *  документы она уже видела, а лишний путь к ним — лишний риск. */
export const ownVerificationSchema = z.object({
  status: verificationRequestStatusSchema.nullable(),
  submittedAt: z.string().datetime().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
});
export type OwnVerification = z.infer<typeof ownVerificationSchema>;

/** Строка в списке заявок у модератора. */
export const verificationRequestSchema = z.object({
  id: z.string(),
  status: verificationRequestStatusSchema,
  submittedAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
  profile: z.object({
    id: z.string(),
    slug: slugSchema,
    displayName: z.string(),
    cityName: z.string(),
    kind: listingKindSchema,
    isVerified: z.boolean(),
  }),
  ownerEmail: z.string(),
});
export type VerificationRequestItem = z.infer<typeof verificationRequestSchema>;

/** Заявка целиком: то же плюс адреса снимков через API. */
export const verificationRequestDetailSchema = verificationRequestSchema.extend({
  photos: z.record(verificationPhotoKindSchema, z.string()),
  /** Снимки удалены по сроку хранения — решение осталось, файлов нет. */
  isPurged: z.boolean(),
});
export type VerificationRequestDetail = z.infer<typeof verificationRequestDetailSchema>;

/**
 * Анкета строкой в списке на карточке владельца — пользователя или агентства
 * (`ManagedUserDetail`/`CompanyTariffState`). Одна форма на оба места:
 * список анкет читается и выглядит одинаково, к какой бы сущности ни принадлежал
 * владелец.
 */
export const profileSummarySchema = z.object({
  id: z.string(),
  slug: slugSchema,
  displayName: z.string(),
  status: z.string(),
  cityName: z.string(),
  isVerified: z.boolean(),
  isFeatured: z.boolean(),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

/**
 * Пользователь целиком — для страницы в модерации. К списочным полям
 * добавлены тип размещения, подписка и анкеты: за этим на страницу и идут.
 */
export const managedUserDetailSchema = managedUserSchema.extend({
  locale: z.string(),
  lastLoginAt: z.string().datetime().nullable(),
  deletionRequestedAt: z.string().datetime().nullable(),
  subscription: z
    .object({
      status: z.enum(['active', 'grace', 'expired']),
      kind: z.enum(['individual', 'agency', 'salon']),
      /** `null` — размещение выдано акцией, а не куплено. */
      term: z.enum(['m1', 'm6', 'm12']).nullable(),
      expiresAt: z.string().datetime(),
    })
    .nullable(),
  profiles: z.array(profileSummarySchema),
});
export type ManagedUserDetail = z.infer<typeof managedUserDetailSchema>;
