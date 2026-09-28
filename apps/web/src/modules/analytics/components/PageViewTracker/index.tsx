'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/modules/analytics/tracker';
import { usePathname } from '@/shared/i18n/navigation';

/**
 * Заход на страницу без анкеты: город, категория, поиск, главная (фаза 1).
 * Профильная страница считается отдельно и подробнее — `ViewTracker` шлёт
 * `view` синхронно и с городом/категорией анкеты; здесь — только путь, для
 * общей картины трафика по каталогу.
 *
 * Висит один раз в корневом layout, а не на каждой странице: маршрут за неё
 * читает `usePathname`, и переход между страницами без полной перезагрузки
 * тоже считается — как и должен для SPA-навигации next/link.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (sent.current === pathname) return;
    sent.current = pathname;
    track({ name: 'page_view', path: pathname });
  }, [pathname]);

  return null;
}
