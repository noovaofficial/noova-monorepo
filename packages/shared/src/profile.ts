import { z } from 'zod';
import {
  booleanFromString,
  citySchema,
  cursorPaginationSchema,
  moneySchema,
  queryArraySchema,
  queryEnumArraySchema,
  slugSchema,
} from './common';
import { paymentMethodSchema, profileCompanySchema } from './company';
import { contactTypeSchema } from './contact';

/**
 * Языки, на которых говорят в анкетах. Один список на форму редактирования
 * и на фильтр каталога: разойдись они — владелица укажет язык, по которому
 * её никто не найдёт, либо наоборот. Коды ISO 639-1, подписи — из словаря
 * `languageNames`.
 */
export const SPOKEN_LANGUAGES = ['de', 'en', 'ru', 'pl', 'tr', 'es', 'fr', 'it'] as const;
export type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number];

/** Тип листинга. Раздельные ветки каталога с главной страницы. */
export const listingKindSchema = z.enum(['escort', 'massage']);
export type ListingKind = z.infer<typeof listingKindSchema>;

/**
 * Статус анкеты. Публикуется только `published`, и только после
 * пройденной верификации возраста и личности — см. documentation/arch/architecture.md §6.
 */
export const profileStatusSchema = z.enum([
  'draft',
  'pending_verification',
  'published',
  'paused',
  'rejected',
  'banned',
]);
export type ProfileStatus = z.infer<typeof profileStatusSchema>;

export const verificationStatusSchema = z.enum(['none', 'pending', 'verified', 'failed']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const photoSchema = z.object({
  id: z.string(),
  /** Средний размер: карточки и главное фото галереи. */
  url: z.string(),
  /** Крупный размер для полноэкранного просмотра. */
  fullUrl: z.string(),
  blurDataUrl: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  position: z.number().int().nonnegative(),
});
export type Photo = z.infer<typeof photoSchema>;

export const priceSlotSchema = z.object({
  /** Длительность в минутах: 60, 120, «ночь» = 720. */
  durationMinutes: z.number().int().positive(),
  incall: moneySchema.nullable(),
  outcall: moneySchema.nullable(),
});
export type PriceSlot = z.infer<typeof priceSlotSchema>;

/* ------------------------------------------------------------------------ *
 * Салон. Салон — это анкета, а не сущность рядом с ней (решение владельца
 * продукта): одна учётная запись салона = одна анкета в каталоге. Поэтому
 * адрес, часы, удобства и запись живут здесь, а не в `Company`.
 * ------------------------------------------------------------------------ */

/**
 * Удобства салона. Закрытый набор, а не свободный текст: набранные руками,
 * они разойдутся в написании («душ» / «Душ» / «есть душ») и не станут
 * фильтром — та же причина, по которой отказались от свободных тегов анкеты.
 */
export const AMENITIES = [
  'shower',
  'sauna',
  'parking',
  'air_conditioning',
  'separate_entrance',
  'wifi',
  'drinks',
  'towels',
  'accessible',
] as const;
export const amenitySchema = z.enum(AMENITIES);
export type Amenity = z.infer<typeof amenitySchema>;

/** Только по записи или принимают без неё. */
export const bookingPolicySchema = z.enum(['appointment', 'walk_in']);
export type BookingPolicy = z.infer<typeof bookingPolicySchema>;

/** Минуты от полуночи: 0 — 00:00, 1439 — 23:59. */
const minuteOfDaySchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 - 1);

/**
 * Часы работы одного дня.
 *
 * Оба поля пустые — выходной. Заполнено одно — ошибка: «открыто с 10:00»
 * без закрытия не говорит посетителю ничего.
 *
 * `closesAt` меньше `opensAt` означает переход через полночь: салон с
 * 10:00 до 02:00 — обычное дело, и запрещать такой интервал значит
 * заставлять заводить его двумя днями.
 */
export const salonHoursSchema = z
  .object({
    /** 1 — понедельник, 7 — воскресенье (ISO-8601). */
    weekday: z.number().int().min(1).max(7),
    opensAt: minuteOfDaySchema.nullable(),
    closesAt: minuteOfDaySchema.nullable(),
  })
  .refine((v) => (v.opensAt === null) === (v.closesAt === null), {
    path: ['closesAt'],
    message: 'Укажите и начало, и конец — либо оставьте день выходным',
  })
  .refine((v) => v.opensAt === null || v.opensAt !== v.closesAt, {
    path: ['closesAt'],
    message: 'Начало и конец совпадают: это не интервал',
  });
export type SalonHours = z.infer<typeof salonHoursSchema>;

/**
 * Круглосуточно — это не отдельный флаг в базе, а вся неделя, заполненная
 * сутками. Отдельное поле пришлось бы держать в согласии с часами, а
 * рассогласование здесь означает неверное расписание на витрине.
 *
 * Конец — 23:59, а не 00:00: схема выше запрещает совпадение начала и конца
 * («это не интервал»), и полуночь-в-полуночь она бы не пропустила.
 */
export const AROUND_THE_CLOCK = { opensAt: 0, closesAt: 24 * 60 - 1 } as const;

/** Признак для интерфейса: и редактор, и витрина должны понимать его одинаково. */
export function isAroundTheClock(hours: readonly SalonHours[]): boolean {
  if (hours.length !== 7) return false;
  if (new Set(hours.map((h) => h.weekday)).size !== 7) return false;
  return hours.every(
    (h) => h.opensAt === AROUND_THE_CLOCK.opensAt && h.closesAt === AROUND_THE_CLOCK.closesAt,
  );
}

/** Неделя целиком: ровно семь дней, без пропусков и повторов. */
export const salonWeekSchema = z
  .array(salonHoursSchema)
  .max(7)
  .refine((days) => new Set(days.map((d) => d.weekday)).size === days.length, {
    message: 'День недели повторяется',
  });

export const serviceSchema = z.object({
  key: z.string(),
  group: z.string(),
  /** Названия на языке запроса — см. serviceOptionSchema. */
  name: z.string(),
  groupName: z.string(),
  extra: z.boolean().default(false),
});
export type Service = z.infer<typeof serviceSchema>;

export const hairColorSchema = z.enum(['blonde', 'brunette', 'black', 'red', 'brown', 'other']);
export type HairColor = z.infer<typeof hairColorSchema>;

export const eyeColorSchema = z.enum(['blue', 'green', 'brown', 'grey', 'hazel']);
export type EyeColor = z.infer<typeof eyeColorSchema>;

export const breastSizeSchema = z.enum(['a', 'b', 'c', 'd', 'e', 'f_plus']);
export type BreastSize = z.infer<typeof breastSizeSchema>;

/** «Натуральная» и «силикон» взаимоисключающи — поэтому перечисление. */
export const breastTypeSchema = z.enum(['natural', 'silicone']);
export type BreastType = z.infer<typeof breastTypeSchema>;

export const bodyTypeSchema = z.enum(['slim', 'thin', 'athletic', 'normal', 'curvy']);
export type BodyType = z.infer<typeof bodyTypeSchema>;

export const pubicHairSchema = z.enum(['natural', 'trimmed', 'shaved']);
export type PubicHair = z.infer<typeof pubicHairSchema>;

/**
 * Тип внешности — самодекларируемое описание облика, а не происхождения.
 * Данные о расовом или этническом происхождении относятся к особой категории
 * по ст. 9 GDPR: хранить их наравне с ростом и весом нельзя. В интерфейсе
 * поле называется «тип внешности», слова «раса» и «национальность» не
 * используются ни в одном языке.
 */
export const appearanceTypeSchema = z.enum([
  'european',
  'asian',
  'latin',
  'african',
  'arab',
  'mixed',
]);
export type AppearanceType = z.infer<typeof appearanceTypeSchema>;

/** Только у индивидуальных анкет: у салона внешности нет. */
export const APPEARANCE_KINDS = ['escort'] as const;

export const paramsSchema = z.object({
  age: z.number().int().min(18).max(99).nullable(),
  heightCm: z.number().int().min(120).max(230).nullable(),
  weightKg: z.number().int().min(35).max(200).nullable(),
  languages: z.array(z.string()).default([]),
  hairColor: hairColorSchema.nullable(),
  eyeColor: eyeColorSchema.nullable(),
  breastSize: breastSizeSchema.nullable(),
  breastType: breastTypeSchema.nullable(),
  bodyType: bodyTypeSchema.nullable(),
  pubicHair: pubicHairSchema.nullable(),
  hasPiercing: z.boolean().nullable(),
  hasTattoos: z.boolean().nullable(),
  appearanceType: appearanceTypeSchema.nullable(),
  smoker: z.boolean().nullable(),
});
export type Params = z.infer<typeof paramsSchema>;

/** Урезанное представление для карточки в гриде — то, что рендерит листинг. */
export const profileCardSchema = z.object({
  id: z.string(),
  slug: slugSchema,
  kind: listingKindSchema,
  displayName: z.string(),
  age: z.number().int().min(18).nullable(),
  city: citySchema,
  district: z.string().nullable(),
  /** Салон или агентство, если анкету ведёт компания (N-31). */
  company: profileCompanySchema.nullable().default(null),
  coverPhoto: photoSchema.nullable(),
  /**
   * Ключи услуг из справочника для подписей на карточке. Раньше здесь были
   * свободные теги — от них отказались: написанные руками, они расходятся
   * в формулировках, не переводятся и не годятся для фильтров.
   */
  /** До шести услуг тегами на карточке: ключ для верстки, название для показа. */
  services: z
    .array(z.object({ key: z.string(), name: z.string() }))
    .max(6)
    .default([]),
  fromPrice: moneySchema.nullable(),
  isVerified: z.boolean(),
  isFeatured: z.boolean(),
  isOnline: z.boolean(),
});
export type ProfileCard = z.infer<typeof profileCardSchema>;

/** Полная анкета для страницы профиля. */
export const profileDetailSchema = profileCardSchema.extend({
  status: profileStatusSchema,
  description: z.string(),
  photos: z.array(photoSchema),
  params: paramsSchema,
  prices: z.array(priceSlotSchema),
  services: z.array(serviceSchema),
  /* --- Салон (N-34): у анкеты человека эти поля пусты. ------------------- */
  address: z.string().nullable().default(null),
  directions: z.string().nullable().default(null),
  minSessionMinutes: z.number().int().nullable().default(null),
  bookingPolicy: bookingPolicySchema.nullable().default(null),
  payments: z.array(paymentMethodSchema).default([]),
  amenities: z.array(z.string()).default([]),
  hours: z.array(salonHoursSchema).default([]),
  /** Координаты намеренно огрублены до района — точный адрес не публикуется. */
  approxLocation: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  /**
   * Какие способы связи есть — но не сами контакты. Значения отдаёт только
   * маршрут раскрытия: попади они сюда, гейт стал бы декоративным и вся база
   * собиралась бы одним `curl`. Типов достаточно, чтобы нарисовать строки
   * до нажатия и не обещать кнопок, которых не будет.
   */
  contactTypes: z.array(contactTypeSchema),
  verifiedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type ProfileDetail = z.infer<typeof profileDetailSchema>;

export const profileSortSchema = z.enum(['relevance', 'newest', 'price_asc', 'price_desc']);
export type ProfileSort = z.infer<typeof profileSortSchema>;

export const profileQuerySchema = cursorPaginationSchema.extend({
  kind: listingKindSchema.default('escort'),
  city: slugSchema.optional(),
  district: z.string().optional(),
  /** Ключи услуг из справочника. */
  services: queryArraySchema().optional(),
  onlineOnly: booleanFromString().optional(),
  verifiedOnly: booleanFromString().optional(),
  featuredOnly: booleanFromString().optional(),
  /** Только анкеты, у которых есть хотя бы один опубликованный отзыв (N-10). */
  withCommentsOnly: booleanFromString().optional(),
  minPriceCents: z.coerce.number().int().nonnegative().optional(),
  maxPriceCents: z.coerce.number().int().nonnegative().optional(),
  ageMin: z.coerce.number().int().min(18).optional(),
  ageMax: z.coerce.number().int().max(99).optional(),
  // Внешность — колонки-перечисления в БД: значение вне набора Postgres
  // не принимает, поэтому неизвестное отбрасывается на разборе.
  hairColor: queryEnumArraySchema(hairColorSchema).optional(),
  eyeColor: queryEnumArraySchema(eyeColorSchema).optional(),
  breastSize: queryEnumArraySchema(breastSizeSchema).optional(),
  breastType: queryEnumArraySchema(breastTypeSchema).optional(),
  bodyType: queryEnumArraySchema(bodyTypeSchema).optional(),
  pubicHair: queryEnumArraySchema(pubicHairSchema).optional(),
  hasPiercing: booleanFromString().optional(),
  hasTattoos: booleanFromString().optional(),
  appearanceType: queryEnumArraySchema(appearanceTypeSchema).optional(),
  heightMin: z.coerce.number().int().optional(),
  heightMax: z.coerce.number().int().optional(),
  weightMin: z.coerce.number().int().optional(),
  weightMax: z.coerce.number().int().optional(),
  languages: queryArraySchema().optional(),
  sort: profileSortSchema.default('relevance'),
  /**
   * Номер страницы, с единицы.
   *
   * Курсор устойчивее и дешевле, но не даёт постоянных адресов: боту нужна
   * ссылка `?page=2`, которую можно обойти и переобойти. Поэтому в каталоге
   * работает смещение, а курсор остаётся для подгрузки «показать ещё».
   */
  page: z.coerce.number().int().min(1).max(500).optional(),
});
export type ProfileQuery = z.infer<typeof profileQuerySchema>;
