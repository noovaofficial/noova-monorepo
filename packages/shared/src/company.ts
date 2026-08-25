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

export const companyInputSchema = z
  .object({
    slug: slugSchema,
    kind: companyKindSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(4000).optional(),
    /** Только у салона: адрес и есть то, чем он отличается от агентства. */
    address: z.string().trim().max(300).optional(),
    contacts: z.array(companyContactSchema).max(8).default([]),
    isActive: z.boolean().default(true),
  })
  .refine((value) => value.kind === 'salon' || !value.address, {
    path: ['address'],
    message: 'Адрес есть только у салона: агентство принимает не у себя',
  });
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const companySchema = z.object({
  id: z.string(),
  slug: z.string(),
  kind: companyKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  address: z.string().nullable(),
  contacts: z.array(companyContactSchema),
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
