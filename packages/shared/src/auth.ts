import { z } from 'zod';
import { MIN_AGE } from './common';
import { LOCALES } from './locales';

export const userRoleSchema = z.enum(['client', 'advertiser', 'moderator', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const genderSchema = z.enum(['male', 'female', 'other']);
export type Gender = z.infer<typeof genderSchema>;

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Нижняя граница длины важнее верхней: короткие пароли ломаются перебором.
 * Верхняя нужна лишь чтобы не хэшировать мегабайты — argon2 не имеет лимита
 * bcrypt в 72 байта, поэтому обрезать пароль не требуется.
 */
export const passwordSchema = z.string().min(10).max(200);

export const nicknameSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N}_-]+$/u, 'Никнейм: буквы, цифры, дефис и подчёркивание');

const currentYear = new Date().getUTCFullYear();

/** Год рождения, а не возраст: возраст протухает и требует пересчёта. */
export const birthYearSchema = z
  .number()
  .int()
  .min(currentYear - 100)
  .max(currentYear - MIN_AGE);

/**
 * Язык интерфейса на момент регистрации. Им уходят письма и он сохраняется
 * пользователю.
 *
 * Раньше язык брался из `Accept-Language`, и это было неверно: заголовок
 * говорит о настройках браузера, а не о том, какой язык человек выбрал на
 * сайте. Русскоязычный браузер получал русские письма, даже если сайт был
 * открыт на немецком.
 *
 * Необязательное: старые клиенты и curl обойдутся заголовком.
 */
const localeFieldSchema = z.enum(LOCALES).optional();

export const registerClientSchema = z.object({
  role: z.literal('client'),
  email: emailSchema,
  password: passwordSchema,
  // Единственное обязательное поле профиля клиента.
  nickname: nicknameSchema,
  name: z.string().trim().min(1).max(60).optional(),
  birthYear: birthYearSchema.optional(),
  gender: genderSchema.optional(),
  locale: localeFieldSchema,
});
export type RegisterClientInput = z.infer<typeof registerClientSchema>;

export const registerAdvertiserSchema = z.object({
  role: z.literal('advertiser'),
  email: emailSchema,
  password: passwordSchema,
  // Тип задаётся при регистрации: от него зависит и лимит анкет, и их вид.
  // Выводить это из первой созданной анкеты нельзя — проверять нужно раньше,
  // чем анкета появилась.
  advertiserKind: z.enum(['individual', 'agency', 'salon']),
  locale: localeFieldSchema,
});
export type RegisterAdvertiserInput = z.infer<typeof registerAdvertiserSchema>;

export const registerSchema = z.discriminatedUnion('role', [
  registerClientSchema,
  registerAdvertiserSchema,
]);
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(1).max(200) });

export const clientProfileSchema = z.object({
  nickname: nicknameSchema,
  name: z.string().nullable(),
  birthYear: z.number().int().nullable(),
  gender: genderSchema.nullable(),
});
export type ClientProfile = z.infer<typeof clientProfileSchema>;

/** Представление текущего пользователя. Пароль и токены сюда не попадают. */
export const currentUserSchema = z.object({
  id: z.string(),
  email: emailSchema,
  role: userRoleSchema,
  isEmailVerified: z.boolean(),
  advertiserKind: z.enum(['individual', 'agency', 'salon']).nullable(),
  clientProfile: clientProfileSchema.nullable(),
  /**
   * Когда запрошено удаление. Не null — учётка в отсрочке: интерфейс должен
   * сказать об этом и дать отменить, иначе человек решит, что удаление
   * не сработало.
   */
  deletionRequestedAt: z.string().datetime().nullable(),
  /** До какого момента удаление можно отменить. */
  deletionEffectiveAt: z.string().datetime().nullable(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/**
 * Ответ регистрации и сброса пароля намеренно одинаков независимо от того,
 * существует ли учётка: иначе форма превращается в оракул «есть ли у вас тут
 * аккаунт», что для каталога 18+ прямой вред посетителям.
 */
export const acknowledgedSchema = z.object({ ok: z.literal(true) });

/**
 * Удаление учётной записи требует пароля, а не одного нажатия: с угнанной
 * сессией иначе можно стереть чужой заработок, и откатить это нечем.
 */
export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
