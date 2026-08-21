import { type ProfileQuery, profileQuerySchema } from '@noova/shared';

/**
 * Состояние фильтров живёт в URL, а не в React.
 *
 * Так фильтрованную выдачу можно переслать ссылкой, кнопка «назад» ведёт себя
 * ожидаемо, а серверный рендер получает те же параметры, что и клиент —
 * без этого страница была бы динамической только на клиенте и не попадала бы
 * в индекс осмысленно.
 */

/** Параметры, допускающие несколько значений. */
export const MULTI_KEYS = [
  'services',
  'hairColor',
  'eyeColor',
  'breastSize',
  'breastType',
  'bodyType',
  'pubicHair',
  'appearanceType',
  'languages',
] as const;

export type MultiKey = (typeof MULTI_KEYS)[number];

/** Ключи, которые не считаются «фильтром» при подсчёте и сбросе. */
const STRUCTURAL_KEYS = new Set(['kind', 'sort', 'limit', 'cursor', 'page']);

export function parseFilters(searchParams: Record<string, string | string[] | undefined>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    normalized[key] = value;
  }

  const parsed = profileQuerySchema.safeParse(normalized);
  // Мусор в адресной строке не должен ронять страницу: показываем каталог
  // без фильтров, а не ошибку.
  return parsed.success ? parsed.data : profileQuerySchema.parse({});
}

/** Сколько фильтров реально применено — для бейджа на кнопке. */
export function countActiveFilters(params: URLSearchParams): number {
  let count = 0;
  for (const key of new Set(params.keys())) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    count += params.getAll(key).filter(Boolean).length;
  }
  return count;
}

/** Переключает одно значение многозначного параметра. */
export function toggleValue(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  const current = next.getAll(key);
  next.delete(key);
  const updated = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  for (const item of updated) next.append(key, item);
  // Смена фильтра всегда возвращает на первую страницу: иначе пользователь
  // окажется на пятой странице выдачи, в которой теперь две позиции.
  next.delete('page');
  return next;
}

/** Устанавливает или убирает однозначный параметр. */
export function setValue(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === undefined || value === '') next.delete(key);
  else next.set(key, value);
  next.delete('page');
  return next;
}

/** Сбрасывает всё, кроме структурных параметров. */
export function clearFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of STRUCTURAL_KEYS) {
    const value = params.get(key);
    if (value && key !== 'page' && key !== 'cursor') next.set(key, value);
  }
  return next;
}

export type { ProfileQuery };
