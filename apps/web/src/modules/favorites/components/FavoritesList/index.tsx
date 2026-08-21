'use client';

import type { Locale } from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { ProfileCard } from '@/modules/catalog/components/ProfileCard';
import { fetchFavorites } from '@/modules/favorites/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { useFavorites } from '../FavoritesProvider';
import styles from './FavoritesList.module.css';

export function FavoritesList({ locale }: { locale: string }) {
  const t = useTranslations('favorites');
  const { status, user } = useSession();
  // Подписываемся на общее состояние: снятое сердце должно убирать карточку
  // отсюда сразу, без перезагрузки страницы.
  const { ids } = useFavorites();
  const router = useRouter();

  const list = useQuery({
    queryKey: queryKeys.favorites(),
    queryFn: fetchFavorites,
    enabled: status === 'authenticated' && user?.role === 'client',
  });

  const items = list.data ?? null;
  const failed = list.isError;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (status === 'authenticated' && user?.role !== 'client') {
    // Роль без избранного попала сюда по прямой ссылке. Показываем причину,
    // а не пустой список: пустота выглядела бы как «вы ничего не отметили».
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>{t('clientsOnly')}</p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>{t('loadFailed')}</p>
      </div>
    );
  }

  if (!items) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>{t('loading')}</p>
      </div>
    );
  }

  // Отфильтровываем по общему состоянию, а не по загруженному списку:
  // иначе снятая карточка висела бы до перезагрузки.
  const visible = ids ? items.filter((item) => ids.has(item.profile.id)) : items;

  if (visible.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('emptyTitle')}</p>
          <p>{t('emptyHint')}</p>
          <div className={styles.actions}>
            <Link href="/catalog/escort">
              <Button>{t('toCatalog')}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
        <span className={styles.count}>{t('count', { count: visible.length })}</span>
      </div>

      <div className={styles.grid}>
        {visible.map((item) => (
          <div key={item.profile.id} className={styles.item}>
            {item.isAvailable ? null : (
              <span className={styles.unavailableNote}>{t('unavailable')}</span>
            )}
            <ProfileCard
              profile={item.profile}
              locale={locale as Locale}
              unavailable={!item.isAvailable}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
