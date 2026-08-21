'use client';

import type { ServiceGroup } from '@noova/shared';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FilterPanel } from '@/modules/filters/components/FilterPanel';
import { countActiveFilters } from '@/modules/filters/params';
import { Link, usePathname } from '@/shared/i18n/navigation';
import styles from '../Header.module.css';

/**
 * Кнопка «Фильтры» в шапке — единственная точка входа в панель.
 *
 * Ведёт себя по-разному в зависимости от страницы: на каталоге правки
 * применяются к текущей выдаче сразу, на остальных страницах копятся
 * и применяются переходом в каталог. Две кнопки на одной странице (одна
 * в шапке, другая над выдачей) сбивали бы с толку.
 */
export function HeaderFilters({ catalog }: { catalog: ServiceGroup[] }) {
  const t = useTranslations('nav');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const onCatalog = pathname.startsWith('/catalog');
  const kind = pathname.startsWith('/catalog/massage') ? 'massage' : 'escort';
  const active = onCatalog ? countActiveFilters(new URLSearchParams(searchParams.toString())) : 0;
  const onMap = pathname.endsWith('/map');

  // Карта наследует текущие фильтры: переход «список ↔ карта» ничего
  // не сбрасывает, иначе выбранное приходится набирать заново.
  const mapQuery = onCatalog ? searchParams.toString() : '';
  const mapHref = `/catalog/${kind}/map${mapQuery ? `?${mapQuery}` : ''}`;

  return (
    <>
      <button type="button" className={styles.filterBtn} onClick={() => setOpen(true)}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        <span>{t('filters')}</span>
        {active > 0 ? <span className={styles.filterCount}>{active}</span> : null}
      </button>

      {/* Карта — рядом с фильтрами и после них: это другой способ смотреть
          ту же выдачу, а не ещё один фильтр. На самой карте кнопку не
          показываем — возврат в список есть в её заголовке. */}
      {onMap ? null : (
        <Link className={styles.filterBtn} href={mapHref}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
          <span>{t('mapView')}</span>
        </Link>
      )}

      {open ? (
        <FilterPanel
          kind={kind}
          catalog={catalog}
          initial={onCatalog ? searchParams.toString() : ''}
          onClose={() => setOpen(false)}
          mode={onCatalog ? 'live' : 'navigate'}
        />
      ) : null}
    </>
  );
}
