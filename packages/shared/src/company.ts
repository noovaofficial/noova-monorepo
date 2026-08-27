/**
 * Салон или агентство (N-31).
 *
 * Разница по существу одна: **у салона есть адрес**, он принимает у себя;
 * агентство ведёт анкеты без общего места. Всё остальное — описание,
 * контакты, страница — у них общее, и разводить две сущности ради одного
 * поля значило бы дважды писать одну и ту же админку.
 *
 * Индивидуалки здесь нет: она размещает себя, и «компания из одного
 * человека» была бы выдуманной сущностью ради единообразия.
 */
import { z } from 'zod';
import { slugSchema } from './common';
import { contactTypeSchema } from './contact';

export const companyKindSchema = z.enum(['agency', 'salon']);
export type CompanyKind = z.infer<typeof companyKindSchema>;

export const companyContactSchema = z.object({
  type: contactTypeSchema,
  value: z.string().trim().min(3).max(64),
});
export type CompanyContact = z.infer<typeof companyContactSchema>;

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

export const paymentMethodSchema = z.enum(['cash', 'card', 'transfer']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** Только по записи или принимают без неё. */
export const bookingPolicySchema = z.enum(['appointment', 'walk_in']);
export type BookingPolicy = z.infer<typeof bookingPolicySchema>;

export const companyPriceSchema = z.object({
  title: z.string().trim().min(2).max(80),
  durationMinutes: z.number().int().min(15).max(1440),
  priceCents: z.number().int().min(0).max(10_000_00),
});
export type CompanyPrice = z.infer<typeof companyPriceSchema>;

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
export const companyHoursSchema = z
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
export type CompanyHours = z.infer<typeof companyHoursSchema>;

/** Неделя целиком: ровно семь дней, без пропусков и повторов. */
export const companyWeekSchema = z
  .array(companyHoursSchema)
  .max(7)
  .refine((days) => new Set(days.map((d) => d.weekday)).size === days.length, {
    message: 'День недели повторяется',
  });

export const companyInputSchema = z
  .object({
    slug: slugSchema,
    kind: companyKindSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(4000).optional(),
    /** Только у салона: адрес и есть то, чем он отличается от агентства. */
    address: z.string().trim().max(300).optional(),
    contacts: z.array(companyContactSchema).max(8).default([]),
    /** Часы работы — только у салона, по той же причине, что и адрес. */
    hours: companyWeekSchema.default([]),
    directions: z.string().trim().max(500).optional(),
    minSessionMinutes: z.number().int().min(15).max(1440).optional(),
    bookingPolicy: bookingPolicySchema.optional(),
    /** Языки персонала: коды из SPOKEN_LANGUAGES. */
    languages: z.array(z.string().length(2)).max(8).default([]),
    payments: z.array(paymentMethodSchema).max(3).default([]),
    amenities: z.array(amenitySchema).max(AMENITIES.length).default([]),
    prices: z.array(companyPriceSchema).max(20).default([]),
    isActive: z.boolean().default(true),
  })
  .refine((value) => value.kind === 'salon' || !value.address, {
    path: ['address'],
    message: 'Адрес есть только у салона: агентство принимает не у себя',
  })
  .refine((value) => value.kind === 'salon' || value.hours.length === 0, {
    path: ['hours'],
    message: 'Часы работы есть только у салона: у агентства нет помещения',
  })
  // Удобства, прайс, запись и минимальный сеанс — свойства помещения.
  // У агентства его нет, и заполненные поля означали бы, что тип выбран
  // ошибочно, а не что агентство завело себе душ.
  .refine(
    (value) =>
      value.kind === 'salon' ||
      (value.amenities.length === 0 &&
        value.prices.length === 0 &&
        !value.bookingPolicy &&
        value.minSessionMinutes === undefined),
    { path: ['amenities'], message: 'Эти поля есть только у салона' },
  );
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const companySchema = z.object({
  id: z.string(),
  slug: z.string(),
  kind: companyKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  address: z.string().nullable(),
  contacts: z.array(companyContactSchema),
  hours: z.array(companyHoursSchema),
  directions: z.string().nullable(),
  minSessionMinutes: z.number().int().nullable(),
  bookingPolicy: bookingPolicySchema.nullable(),
  languages: z.array(z.string()),
  payments: z.array(paymentMethodSchema),
  amenities: z.array(z.string()),
  prices: z.array(companyPriceSchema),
  isActive: z.boolean(),
  profileCount: z.number().int().nonnegative(),
});
export type Company = z.infer<typeof companySchema>;

/**
 * Компания в публичном представлении анкеты. Посетитель видит и салон, и
 * агентство — решение владельца продукта: скрывать принадлежность значит
 * показывать посетителю меньше, чем он вправе знать.
 */
export const profileCompanySchema = z.object({
  slug: z.string(),
  kind: companyKindSchema,
  name: z.string(),
});
export type ProfileCompany = z.infer<typeof profileCompanySchema>;
