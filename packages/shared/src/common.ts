import { z } from 'zod';

/** Возрастной минимум — жёсткое продуктовое ограничение (18+). */
export const MIN_AGE = 18;

export const idSchema = z.string().min(1);
export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug: только строчные латинские буквы, цифры и дефис');

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative().nullable(),
  });

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  total: number | null;
};

export const moneySchema = z.object({
  /** Всегда в минорных единицах (центах), чтобы не ловить ошибки округления. */
  amountCents: z.number().int().nonnegative(),
  currency: z.literal('EUR').default('EUR'),
});
export type Money = z.infer<typeof moneySchema>;

/**
 * Повторяющийся query-параметр (`?services=a&services=b`) приходит массивом,
 * а одиночный — строкой. Без нормализации фильтр с одним значением падает
 * на валидации.
 */
export const queryArraySchema = (item: z.ZodString = z.string()) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    return Array.isArray(value) ? value : [value];
  }, z.array(item));

/**
 * То же для параметра с закрытым набором значений, но **неизвестные значения
 * отбрасываются, а не роняют разбор**.
 *
 * Разница не косметическая. Эти параметры ложатся в `where` по колонке-перечислению
 * (`hairColor`, `eyeColor` и остальная внешность), и значение вне набора
 * Postgres не принимает: адрес `?eyeColor=xxx` отвечал пятисоткой. Попасть
 * туда легко — правка адреса руками, старая ссылка после переименования
 * значения, бот с обрезанным параметром.
 *
 * Строгий `z.enum` внутри массива тоже не годится: он завалил бы разбор
 * целиком, и вместе с одним негодным значением потерялись бы все соседние
 * фильтры. Поэтому негодные отсеиваются поштучно, а когда не остаётся ни
 * одного — фильтра нет вовсе: показать каталог целиком честнее, чем пустую
 * выдачу по значению, которого в системе не существует.
 */
export const queryEnumArraySchema = <T extends string>(item: z.ZodType<T>) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return undefined;
      const list = Array.isArray(value) ? value : [value];
      const known = list.filter((entry) => item.safeParse(entry).success);
      return known.length > 0 ? known : undefined;
    },
    // `.optional()` именно здесь, а не снаружи. Снаружи он смотрит на вход
    // разбора, а тот задан — это и есть негодное значение; до внутренней
    // схемы доходит `undefined` от препроцессора, и массив его отвергает.
    // Так отброшенный фильтр давал 400 вместо каталога.
    z.array(item).optional(),
  );

/**
 * Булево значение из строки — окружения или query.
 *
 * `z.coerce.boolean()` здесь непригоден: он приводит по правилам JavaScript,
 * а непустая строка истинна. То есть `"false"` и `"0"` превращаются в `true`,
 * и флаг, выключенный в конфиге, оказывается включённым.
 */
export const booleanFromString = (defaultValue?: boolean) =>
  z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return undefined;
  }, z.boolean());

export const citySchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  countryCode: z.string().length(2),
});
export type City = z.infer<typeof citySchema>;
