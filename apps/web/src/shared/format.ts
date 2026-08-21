import type { Locale, Money } from '@noova/shared';

/** Цены хранятся в центах — форматируем через Intl, а не делением в разметке. */
export function formatMoney(money: Money | null, locale: Locale): string | null {
  if (!money) return null;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    maximumFractionDigits: 0,
  }).format(money.amountCents / 100);
}

/** 60 → «1 час», 720 → «ночь». Ключ отдаём наружу, перевод делает next-intl. */
export function durationKey(minutes: number): { key: 'hour' | 'night'; count: number } {
  if (minutes >= 600) return { key: 'night', count: 1 };
  return { key: 'hour', count: Math.round(minutes / 60) };
}

/**
 * Плейсхолдер вместо фото: реальных изображений до верификации нет (documentation/architecture.md §2),
 * а пустые серые прямоугольники в сетке выглядят как ошибка загрузки.
 * Градиент детерминирован по id, чтобы карточка не «мигала» между рендерами.
 */
const PLACEHOLDER_GRADIENTS = [
  'radial-gradient(120% 90% at 30% 10%, #F6B8CE 0%, #E0457B 45%, #5A1833 100%)',
  'radial-gradient(120% 90% at 70% 5%, #FFC9A8 0%, #FF8A5C 45%, #7A331A 100%)',
  'radial-gradient(120% 90% at 40% 0%, #D9B8F6 0%, #9B6BD0 50%, #3E2257 100%)',
  'radial-gradient(120% 90% at 60% 10%, #F4C9D7 0%, #C9356B 50%, #4A1730 100%)',
  'radial-gradient(120% 90% at 25% 5%, #FAD9C2 0%, #E07A4A 50%, #5E2A14 100%)',
  'radial-gradient(120% 90% at 75% 0%, #C9D4F0 0%, #6E78B0 50%, #2A3055 100%)',
  'radial-gradient(120% 90% at 35% 10%, #C8E6DD 0%, #3E9E7A 55%, #163B2D 100%)',
  'radial-gradient(120% 90% at 65% 5%, #F2B9C9 0%, #D94A7B 50%, #4F1A30 100%)',
];

export function placeholderGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PLACEHOLDER_GRADIENTS[hash % PLACEHOLDER_GRADIENTS.length]!;
}

/**
 * Перевод ключа справочника с запасным вариантом.
 *
 * Услугу можно деактивировать, но связи с анкетами при этом сохраняются —
 * удаление порвало бы историю. Значит в анкете может встретиться ключ,
 * которого уже нет в словаре, и `t()` на нём падает, унося всю страницу.
 * Показать сам ключ некрасиво, но это несравнимо лучше пустой страницы.
 */
export function translateKey(
  t: (key: string) => string,
  key: string,
  has: (key: string) => boolean,
): string {
  return has(key) ? t(key) : key;
}
