'use client';

import { useEffect } from 'react';

/**
 * Блокирует прокрутку страницы, пока открыт оверлей. Без этого закрытие
 * возвращает человека не туда, где он был: фон уезжает под открытой панелью.
 *
 * Прежнее значение сохраняем и возвращаем, а не пишем `''`: на странице может
 * быть свой `overflow`, и затирать его — значит чинить одно, ломая другое.
 */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
