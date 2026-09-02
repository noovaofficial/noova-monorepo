'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/design-system/components/Button';
import styles from '../Moderation.module.css';

/**
 * Хвост листаемого списка: сколько показано из скольких и кнопка «ещё».
 * Кнопка, а не бесконечная прокрутка: модератор идёт по списку сверху вниз
 * и принимает решения, ему нужно видеть, где список кончается.
 */
export function LoadMore({
  shown,
  total,
  hasMore,
  loading,
  onMore,
}: {
  shown: number;
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const t = useTranslations('moderation');
  if (shown === 0) return null;

  return (
    <div className={styles.loadMore}>
      <span className={styles.hint}>
        {total !== null ? t('shownOf', { shown, total }) : t('shownCount', { shown })}
      </span>
      {hasMore ? (
        <Button variant="secondary" disabled={loading} onClick={onMore}>
          {t('showMore')}
        </Button>
      ) : null}
    </div>
  );
}
