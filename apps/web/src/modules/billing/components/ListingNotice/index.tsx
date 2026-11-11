'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchListing, fetchPlacement } from '@/modules/billing/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './ListingNotice.module.css';

/**
 * Плашка о состоянии подписки — для редактора анкеты. Молчит, пока
 * подписка активна: обычный случай не должен занимать место. Говорит в трёх
 * ситуациях: льготные дни (ещё в каталоге, но скоро снимут), истекла
 * (уже снята) и подписки нет вовсе (публиковать нечем).
 */
export function ListingNotice({ only }: { only?: 'placement' } = {}) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { user } = useSession();

  const listing = useQuery({
    queryKey: queryKeys.listing(),
    queryFn: fetchListing,
    enabled: user?.role === 'advertiser',
  });

  const placement = useQuery({
    queryKey: queryKeys.placement(),
    queryFn: fetchPlacement,
    enabled: user?.role === 'advertiser',
  });

  if (!listing.isSuccess || !placement.isSuccess) return null;
  // Публикация закрыта: говорить о подписке нечего — она ничего не даёт.
  if (!placement.data.allowed) {
    return <p className={`${styles.notice} ${styles.warn}`}>{t('listingClosedNotice')}</p>;
  }
  const free = !placement.data.paid;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });
  const current = listing.data;

  // Размещение стало платным, подписки нет: до конца льготного срока анкеты в
  // каталоге, потом их снимут. Видно и в списке анкет (`only="placement"`).
  if (!free && !current && placement.data.graceEndsAt) {
    return (
      <p className={`${styles.notice} ${styles.warn}`}>
        {t('placementGraceNotice', { date: date(placement.data.graceEndsAt) })}{' '}
        <Link className={styles.link} href="/account/subscription">
          {t('listingNoticeSubscribe')}
        </Link>
      </p>
    );
  }
  if (only === 'placement') return null;

  if (current?.status === 'grace') {
    return (
      <p className={`${styles.notice} ${styles.warn}`}>
        {t(free ? 'listingFreeGraceNotice' : 'listingGraceNotice', {
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
        {t(free ? 'listingFreeExpiredNotice' : 'listingExpiredNotice')}{' '}
        <Link className={styles.link} href="/account/subscription">
          {t(free ? 'listingNoticeSubscribe' : 'listingNoticePay')}
        </Link>
      </p>
    );
  }

  if (!current) {
    return (
      <p className={`${styles.notice} ${styles.info}`}>
        {t(free ? 'listingFreeNotice' : 'listingNoneNotice')}{' '}
        <Link className={styles.link} href="/account/subscription">
          {t(free ? 'listingNoticeSubscribe' : 'listingNoticePay')}
        </Link>
      </p>
    );
  }

  return null;
}
