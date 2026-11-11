'use client';

import { useTranslations } from 'next-intl';

/**
 * Причина сбоя по ответу сервера. Тексты ошибок раньше были «Не удалось
 * сохранить» — без причины и без подсказки, что делать. Теперь к названию
 * действия добавляется причина: нет связи, истекла сессия, лимит запросов,
 * сбой сервера. Человек понимает, чинить ему своё или ждать.
 *
 * Классы ошибок модулей (`AccountError`, `BillingError`, …) разные, но у всех
 * есть числовой `status`, поэтому разбор идёт по нему, а не по `instanceof`.
 */
export type ErrorReason =
  | 'network'
  | 'session'
  | 'payment'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'tooLarge'
  | 'invalid'
  | 'rateLimit'
  | 'server'
  | 'unknown';

export function errorReason(cause: unknown): ErrorReason {
  // fetch отвергается TypeError-ом, когда до сервера не дошли вовсе.
  if (cause instanceof TypeError) return 'network';
  const status =
    typeof cause === 'object' && cause !== null && 'status' in cause
      ? (cause as { status: unknown }).status
      : null;
  if (typeof status !== 'number') return 'unknown';
  if (status === 401) return 'session';
  if (status === 402) return 'payment';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 413) return 'tooLarge';
  if (status === 400 || status === 422) return 'invalid';
  if (status === 429) return 'rateLimit';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Код причины от сервера, если он есть: точнее любого статуса. */
export function errorCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  const code = (cause as { code: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : null;
}

/** Убирает точку в конце названия действия: дальше идёт своя фраза. */
const stripEnd = (text: string) => text.replace(/[\s.。]+$/u, '');

/**
 * «Название действия. Причина и что делать.» Конкретный ответ сервера
 * (например, «пароль неверный») по-прежнему подбирают вызывающие места, а это
 * — запасной путь вместо голого «Не удалось».
 */
export function useErrorText(): (cause: unknown, action: string) => string {
  const t = useTranslations('error');
  return (cause, action) => {
    // Код от сервера говорит, что именно не так («адрес занят»), — он точнее
    // общей причины по статусу. Тексты сервера по-русски, поэтому на экран
    // они не попадают никогда: только перевод по коду.
    const code = errorCode(cause);
    const reason =
      code && t.has(`code_${code}`) ? t(`code_${code}`) : t(`reason_${errorReason(cause)}`);
    return `${stripEnd(action)}. ${reason}`;
  };
}
