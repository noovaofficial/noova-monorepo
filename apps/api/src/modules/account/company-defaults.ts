import { type ContactType, normalizeContact } from '@noova/shared';

/**
 * Контакты компании -> контакты новой анкеты. Нормализуем так же, как при
 * сохранении анкеты, дубли после нормализации схлопываем. Строку, не прошедшую
 * нормализацию (могла попасть в компанию до появления проверки), пропускаем:
 * падать на создании анкеты из-за старой строки хуже, чем создать её без
 * одного контакта.
 */
export function inheritContacts(
  contacts: { type: ContactType; value: string }[],
): { type: ContactType; value: string; position: number }[] {
  const seen = new Set<string>();
  const result: { type: ContactType; value: string; position: number }[] = [];
  for (const c of contacts) {
    const normalized = normalizeContact(c.type, c.value);
    if (!normalized.ok) continue;
    const key = `${c.type}:${normalized.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ type: c.type, value: normalized.value, position: result.length });
  }
  return result;
}

/** Минимальная цена денормализована: по ней идёт сортировка листинга без джойнов. */
export function lowestPriceCents(
  prices: { incallCents: number | null; outcallCents: number | null }[],
): number | null {
  const values = prices
    .flatMap((p) => [p.incallCents, p.outcallCents])
    .filter((v): v is number => v !== null && v > 0);
  return values.length > 0 ? Math.min(...values) : null;
}
