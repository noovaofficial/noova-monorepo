/**
 * Каталог услуг из админки (N-36).
 *
 * Состав каталога определяет, что вообще можно предлагать на площадке, —
 * это решение владельца, а не оператора очереди. Отсюда доступ только у роли
 * `admin`, как и у географии.
 */
import { z } from 'zod';
import { translatedSchema } from './locales';
import { listingKindSchema } from './profile';

/**
 * Ключ услуги неизменяем после создания: он лежит в анкетах, в адресах
 * фильтров каталога и во внешних ссылках. Переименование названия — правка
 * перевода, а не ключа.
 */
export const serviceKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, 'Только латиница в нижнем регистре, цифры и подчёркивание');

export const serviceGroupInputSchema = z.object({
  key: serviceKeySchema,
  name: translatedSchema,
});
export type ServiceGroupInput = z.infer<typeof serviceGroupInputSchema>;

export const serviceInputSchema = z.object({
  key: serviceKeySchema,
  group: serviceKeySchema,
  name: translatedSchema,
  /** Пустой массив — услуга предлагается всем видам анкет. */
  appliesTo: z.array(listingKindSchema).default([]),
  position: z.number().int().min(0).max(100000),
  isActive: z.boolean().default(true),
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;

export const adminServiceSchema = z.object({
  id: z.string(),
  key: z.string(),
  group: z.string(),
  name: translatedSchema,
  appliesTo: z.array(listingKindSchema),
  position: z.number().int(),
  isActive: z.boolean(),
  /** Сколько анкет её выбрали: удалять нельзя, и это объясняет почему. */
  profileCount: z.number().int().nonnegative(),
});
export type AdminService = z.infer<typeof adminServiceSchema>;

export const adminServiceGroupSchema = z.object({
  key: z.string(),
  name: translatedSchema,
  services: z.array(adminServiceSchema),
});
export type AdminServiceGroup = z.infer<typeof adminServiceGroupSchema>;
