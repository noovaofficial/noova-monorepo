import { z } from 'zod';
import {
  booleanFromString,
  citySchema,
  cursorPaginationSchema,
  moneySchema,
  queryArraySchema,
  slugSchema,
} from './common';
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
  hairColor: queryArraySchema().optional(),
  eyeColor: queryArraySchema().optional(),
  breastSize: queryArraySchema().optional(),
  breastType: queryArraySchema().optional(),
  bodyType: queryArraySchema().optional(),
  pubicHair: queryArraySchema().optional(),
  hasPiercing: booleanFromString().optional(),
  hasTattoos: booleanFromString().optional(),
  appearanceType: queryArraySchema().optional(),
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
