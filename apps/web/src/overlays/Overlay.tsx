'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from './useScrollLock';

type Props = {
  children: ReactNode;
  /** Закрыть по Escape. Не у всех оверлеев есть чем закрываться. */
  onClose?: () => void;
  /** Блокировать прокрутку под оверлеем. */
  lockScroll?: boolean;
};

/**
 * Общая обвязка для всего, что рисуется поверх страницы: полноэкранный
 * просмотр фото, панель фильтров, гейт 18+.
 *
 * **Портал в `body` — не деталь, а суть.** Любой предок с `position: sticky`
 * или `fixed` создаёт контекст наложения, и `z-index` потомка считается
 * внутри него, а не на странице. Из-за этого просмотр фото уезжал под шапку,
 * хотя имел `z-index: 200` против её `50`. Панель фильтров рендерится из
 * липкой шапки и заперта ровно так же. Портал выносит содержимое за пределы
 * любого родительского контекста, и порядок снова решается одним числом.
 *
 * Монтируется после гидрации: на сервере `document` не существует.
 */
export function Overlay({ children, onClose, lockScroll = true }: Props) {
  const [mounted, setMounted] = useState(false);
  useScrollLock(lockScroll);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(children, document.body);
}
