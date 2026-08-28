import { z } from 'zod';
import { moneySchema, slugSchema } from './common';
import { paymentMethodSchema } from './company';
import { contactInputSchema, MAX_CONTACTS_PER_PROFILE, profileContactSchema } from './contact';
import {
  AMENITIES,
  amenitySchema,
  appearanceTypeSchema,
  bodyTypeSchema,
  bookingPolicySchema,
  breastSizeSchema,
  breastTypeSchema,
  eyeColorSchema,
  hairColorSchema,
  listingKindSchema,
  profileStatusSchema,
  pubicHairSchema,
  salonHoursSchema,
  salonWeekSchema,
  verificationStatusSchema,
} from './profile';

export const advertiserKindSchema = z.enum(['individual', 'agency', 'salon']);
export type AdvertiserKind = z.infer<typeof advertiserKindSchema>;

/** Какой вид анкет разрешён владельцу. Смешивать типы нельзя. */
/**
 * Ветка каталога по типу рекламодателя (N-31).
 *
 * Отсюда же следует «у салона свои услуги»: анкета салона всегда massage,
 * а услуги отбираются по `Service.appliesTo` — отдельного справочника для
 * салона заводить не пришлось.
 */
export const LISTING_KIND_BY_ADVERTISER: Record<AdvertiserKind, 'escort' | 'massage'> = {
  individual: 'escort',
  agency: 'escort',
  salon: 'massage',
};

/** Сколько анкет разрешено. У индивидуалки ровно одна — она размещает себя. */
export const PROFILE_LIMIT_BY_ADVERTISER: Record<AdvertiserKind, number> = {
  individual: 1,
  // У салона одна анкета — она и есть салон (N-34). Отдельных анкет
  // массажисток нет: салон показывается в каталоге одной записью.
  salon: 1,
  agency: 50,
};

export const priceSlotInputSchema = z.object({
  durationMinutes: z.number().int().positive().max(1440),
  incallCents: z.number().int().nonnegative().max(10_000_00).nullable(),
  outcallCents: z.number().int().nonnegative().max(10_000_00).nullable(),
});
export type PriceSlotInput = z.infer<typeof priceSlotInputSchema>;

/** См. комментарий у `services` в `updateProfileSchema`. */
export const MAX_SERVICES_PER_PROFILE = 300;

export const createProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  citySlug: slugSchema,
  districtSlug: slugSchema.optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

/**
 * Одна услуга в справочнике. Название приходит из API уже на нужном языке —
 * раньше искалось по ключу в словарях фронта, но справочник редактируется
 * из админки, и заведённая услуга в словарь не попадёт (N-35).
 */
export const serviceOptionSchema = z.object({
  key: z.string(),
  group: z.string(),
  name: z.string(),
});
export type ServiceOption = z.infer<typeof serviceOptionSchema>;

export const serviceGroupSchema = z.object({
  group: z.string(),
  /** Название группы на языке запроса. */
  name: z.string(),
  services: z.array(serviceOptionSchema),
});
export type ServiceGroup = z.infer<typeof serviceGroupSchema>;

/** Выбор владельца: какие услуги оказывает и какие из них за доплату. */
export const profileServiceInputSchema = z.object({
  key: z.string().min(1).max(60),
  isExtra: z.boolean().default(false),
});
export type ProfileServiceInput = z.infer<typeof profileServiceInputSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  /* --- Салон. Заполняется только при advertiserKind = salon (N-34). ------ */
  /** Точный адрес заведения. У анкеты человека адреса нет и быть не должно. */
  address: z.string().trim().max(300).nullable().optional(),
  directions: z.string().trim().max(500).nullable().optional(),
  minSessionMinutes: z.number().int().min(15).max(1440).nullable().optional(),
  bookingPolicy: bookingPolicySchema.nullable().optional(),
  payments: z.array(paymentMethodSchema).max(3).optional(),
  amenities: z.array(amenitySchema).max(AMENITIES.length).optional(),
  hours: salonWeekSchema.optional(),
  description: z.string().max(4000).optional(),
  citySlug: slugSchema.optional(),
  districtSlug: slugSchema.nullable().optional(),
  age: z.number().int().min(18).max(99).nullable().optional(),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  weightKg: z.number().int().min(35).max(200).nullable().optional(),
  languages: z.array(z.string().min(2).max(8)).max(10).optional(),
  hairColor: hairColorSchema.nullable().optional(),
  eyeColor: eyeColorSchema.nullable().optional(),
  breastSize: breastSizeSchema.nullable().optional(),
  breastType: breastTypeSchema.nullable().optional(),
  bodyType: bodyTypeSchema.nullable().optional(),
  pubicHair: pubicHairSchema.nullable().optional(),
  hasPiercing: z.boolean().nullable().optional(),
  hasTattoos: z.boolean().nullable().optional(),
  appearanceType: appearanceTypeSchema.nullable().optional(),
  smoker: z.boolean().nullable().optional(),
  /**
   * Точка на карте, выбранная владелицей. Сервер огрубляет её до сетки перед
   * сохранением — проверять это на клиенте бессмысленно, запрос подделывается.
   * `null` возвращает вывод координат из района.
   */
  location: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  prices: z.array(priceSlotInputSchema).max(8).optional(),
  /**
   * Ограничение сверху — защита от раздутого запроса, а не продуктовое
   * правило: каждый ключ всё равно сверяется со справочником. Число обязано
   * с запасом превышать размер каталога, иначе владелец, выбравший все
   * услуги, упрётся в лимит — ровно это и произошло, когда каталог вырос
   * до 61 позиции при лимите 60.
   */
  services: z.array(profileServiceInputSchema).max(MAX_SERVICES_PER_PROFILE).optional(),
  /**
   * Значения здесь ещё в том виде, в каком их набрала владелица. Сервер
   * приводит их к E.164 и «@нику» сам: проверять формат только на клиенте
   * нельзя, а два представления одного номера сломали бы уникальность.
   */
  contacts: z.array(contactInputSchema).max(MAX_CONTACTS_PER_PROFILE).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Фото глазами владельца. Отличается от публичного тем, что показывает
 * и неодобренные снимки — иначе владелец не поймёт, что загруженное фото
 * ждёт модерации. Ссылка на неодобренное подписанная и живёт минуты.
 */
export const ownPhotoSchema = z.object({
  id: z.string(),
  url: z.string(),
  blurDataUrl: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  isApproved: z.boolean(),
  rejectedReason: z.string().nullable(),
});
export type OwnPhoto = z.infer<typeof ownPhotoSchema>;

export const photoOrderSchema = z.object({
  ids: z.array(z.string().min(1)).max(20),
});

/**
 * Анкета глазами владельца. В отличие от публичной, содержит черновики,
 * причину отказа модератора и статус верификации — то, что наружу не отдаётся.
 */
export const ownProfileSchema = z.object({
  /* --- Салон (N-34) ------------------------------------------------------ */
  address: z.string().nullable(),
  directions: z.string().nullable(),
  minSessionMinutes: z.number().int().nullable(),
  bookingPolicy: bookingPolicySchema.nullable(),
  payments: z.array(paymentMethodSchema),
  amenities: z.array(z.string()),
  hours: z.array(salonHoursSchema),
  id: z.string(),
  slug: slugSchema,
  kind: listingKindSchema,
  status: profileStatusSchema,
  displayName: z.string(),
  description: z.string(),
  city: z.object({ slug: slugSchema, name: z.string() }),
  district: z.object({ slug: z.string(), name: z.string() }).nullable(),
  age: z.number().int().nullable(),
  heightCm: z.number().int().nullable(),
  weightKg: z.number().int().nullable(),
  languages: z.array(z.string()),
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
  /** Уже огрублённые координаты — те же, что видит посетитель. */
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  /** Точку поставила владелица; иначе она выведена из района. */
  hasManualLocation: z.boolean(),
  fromPrice: moneySchema.nullable(),
  prices: z.array(priceSlotInputSchema),
  services: z.array(profileServiceInputSchema),
  /** Владелица видит свои контакты всегда — гейт показа стоит только наружу. */
  contacts: z.array(profileContactSchema),
  photos: z.array(ownPhotoSchema),
  verificationStatus: verificationStatusSchema,
  moderationNote: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type OwnProfile = z.infer<typeof ownProfileSchema>;

/** Справочник городов и районов для форм. */
export const cityOptionSchema = z.object({
  slug: slugSchema,
  name: z.string(),
  /** Страна на языке запроса: страница выбора города группирует по ней. */
  country: z.object({ code: z.string(), name: z.string() }),
  districts: z.array(z.object({ slug: z.string(), name: z.string() })),
});
export type CityOption = z.infer<typeof cityOptionSchema>;
