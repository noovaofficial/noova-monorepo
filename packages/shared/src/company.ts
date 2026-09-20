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
import { slugSchema, websiteSchema } from './common';
import { contactTypeSchema } from './contact';

/** Компания есть только у агентства: салон — это анкета (N-34). */
/** Способы оплаты. Общие для агентства и салона. */
export const paymentMethodSchema = z.enum(['cash', 'card', 'transfer']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const companyKindSchema = z.enum(['agency']);
export type CompanyKind = z.infer<typeof companyKindSchema>;

/**
 * Слуги, которые компания занять не может: у каждого агентства есть
 * поддомен `{slug}.{домен}` (N-38), и слуг, совпадающий со служебным
 * поддоменом, увёл бы трафик от настоящего сервиса — например, у площадки
 * уже есть `mail.{домен}` (почтовый релей, docker-compose `smtp`).
 */
export const RESERVED_SUBDOMAINS = [
  'www',
  'api',
  'admin',
  'mail',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'media',
  'app',
  'ns1',
  'ns2',
  'mx',
  'autodiscover',
  'webmail',
] as const;

export const companyContactSchema = z.object({
  type: contactTypeSchema,
  value: z.string().trim().min(3).max(64),
});
export type CompanyContact = z.infer<typeof companyContactSchema>;

export const companySlugSchema = slugSchema.refine(
  (value) => !(RESERVED_SUBDOMAINS as readonly string[]).includes(value),
  { message: 'Этот адрес занят служебным поддоменом — выберите другой' },
);

export const companyInputSchema = z.object({
  slug: companySlugSchema,
  kind: companyKindSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(4000).optional(),
  website: websiteSchema.optional(),
  contacts: z.array(companyContactSchema).max(8).default([]),
  /** Языки персонала: коды из SPOKEN_LANGUAGES. */
  languages: z.array(z.string().length(2)).max(8).default([]),
  payments: z.array(paymentMethodSchema).max(3).default([]),
  isActive: z.boolean().default(true),
});

export type CompanyInput = z.infer<typeof companyInputSchema>;

/** Компания глазами владельца — в кабинете, для правки формы: контакты со
 *  значениями, логотип своей ссылкой. */
export const companySchema = z.object({
  id: z.string(),
  slug: z.string(),
  kind: companyKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  contacts: z.array(companyContactSchema),
  languages: z.array(z.string()),
  payments: z.array(paymentMethodSchema),
  isActive: z.boolean(),
  /** Заблокировано модератором/админом — независимо от `isActive`, которым
   *  распоряжается сам владелец. Разблокировать может только персонал. */
  isBanned: z.boolean(),
  banReason: z.string().nullable(),
  profileCount: z.number().int().nonnegative(),
});
export type Company = z.infer<typeof companySchema>;

/**
 * Компания на публичной странице. В отличие от `companySchema`, значений
 * контактов здесь нет — только типы (`contactTypes`), как у анкеты: это
 * контакт агентства, но раскрывается он тем же жестом и с тем же лимитом,
 * что и контакт анкеты (N-31, симметрично N-08).
 */
export const companyDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  kind: companyKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  languages: z.array(z.string()),
  payments: z.array(paymentMethodSchema),
  contactTypes: z.array(contactTypeSchema),
  /** Онлайн ли агентство прямо сейчас — по самой свежей анкете. */
  isOnline: z.boolean(),
  /** `null`, если ни у одной анкеты ещё не было активности. */
  lastSeenAt: z.string().datetime().nullable(),
  profileCount: z.number().int().nonnegative(),
  /** Оплаченное место в ТОПе агентств прямо сейчас (payments.md §3.5, D-14). */
  isFeatured: z.boolean(),
});
export type CompanyDetail = z.infer<typeof companyDetailSchema>;

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

/**
 * Агентство в подборке на главной. Своего поля города у компании нет —
 * только через анкеты, и агентство при срезе «вся страна» могло бы вести их
 * сразу в нескольких городах, поэтому города на карточке тоже нет. Вместо
 * описания — число опубликованных анкет именно в этом срезе (город/страна),
 * не у агентства в целом.
 */
export const agencyCardSchema = z.object({
  slug: z.string(),
  name: z.string(),
  profileCount: z.number().int().nonnegative(),
  logoUrl: z.string().nullable(),
  /** Оплаченное место в ТОПе агентств прямо сейчас (payments.md §3.5, D-14) —
   *  бейдж на карточке, тот же смысл, что `ProfileCard.isFeatured`. */
  isFeatured: z.boolean(),
});
export type AgencyCard = z.infer<typeof agencyCardSchema>;
