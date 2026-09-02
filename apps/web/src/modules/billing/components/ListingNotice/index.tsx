'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchListing } from '@/modules/billing/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './ListingNotice.module.css';

/**
 * Плашка о состоянии подписки — для редактора анкеты. Молчит, пока
 * подписка активна: обычный случай не должен занимать место. Говорит в трёх
 * ситуациях: льготные дни (ещё в каталоге, но скоро снимут), истекла
 * (уже снята) и подписки нет вовсе (публиковать нечем).
 */
export function ListingNotice() {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { user } = useSession();

  const listing = useQuery({
    queryKey: queryKeys.listing(),
    queryFn: fetchListing,
    enabled: user?.role === 'advertiser',
  });

  if (!listing.isSuccess) return null;
  const current = listing.data;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });

  if (current?.status === 'grace') {
    return (
      <p className={`${styles.notice} ${styles.warn}`}>
        {t('listingGraceNotice', {
          date: date(current.expiresAt),
          graceDate: date(current.graceEndsAt),
        })}{' '}
        <Link className={styles.link} href="/account/subscription">
          {t('listingNoticeExtend')}
        </Link>
      </p>
    );
  }

  if (current?.status === 'expired') {
    return (
      <p className={`${styles.notice} ${styles.error}`}>
        {t('listingExpiredNotice')}{' '}
        <Link className={styles.link} href="/account/subscription">
          {t('listingNoticePay')}
        </Link>
      </p>
    );
  }

  if (!current) {
    return (
      <p className={`${styles.notice} ${styles.info}`}>
        {t('listingNoneNotice')}{' '}
        <Link className={styles.link} href="/account/subscription">
          {t('listingNoticePay')}
        </Link>
      </p>
    );
  }

  return null;
}
