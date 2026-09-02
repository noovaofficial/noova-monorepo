'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchUserDetail } from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Moderation.module.css';

const ADVERTISER_LABEL = {
  individual: 'advertiserIndividual',
  salon: 'advertiserSalon',
  agency: 'advertiserAgency',
} as const;

/**
 * Пользователь целиком. Список отвечает на вопрос «кто это», страница —
 * «что у него»: тип размещения, подписка, баланс, анкеты.
 *
 * Только просмотр. Действия — блокировка, корректировка баланса, удаление —
 * остаются в списке: там их видно рядом с поиском, и они не разъезжаются
 * по двум экранам.
 */
export function UserDetail({ userId }: { userId: string }) {
  const t = useTranslations('moderation');
  // Подписи типов размещения — те же, что при регистрации и в кабинете.
  const ta = useTranslations('auth');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';
  const detail = useQuery({
    queryKey: queryKeys.managedUser(userId),
    queryFn: () => fetchUserDetail(userId),
    enabled: status === 'authenticated' && isStaff,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isStaff) return <p className={styles.empty}>{t('onlyStaff')}</p>;
  if (detail.isError) return <p className={styles.empty}>{t('loadFailed')}</p>;
  if (!detail.data) return <p className={styles.empty}>{t('loading')}</p>;

  const data = detail.data;
  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const rows: { label: string; value: string }[] = [
    { label: t('userRole'), value: t(`role_${data.role}`) },
    ...(data.advertiserKind
      ? [{ label: t('userKind'), value: ta(ADVERTISER_LABEL[data.advertiserKind]) }]
      : []),
    {
      label: t('userSubscription'),
      value: data.subscription
        ? `${t(`subscriptionStatus_${data.subscription.status}`)} · ${t(
            `term_${data.subscription.term}`,
          )} · ${t('userUntil')} ${when(data.subscription.expiresAt)}`
        : t('userNoSubscription'),
    },
    ...(data.role === 'advertiser'
      ? [{ label: t('userBalance'), value: t('balanceGc', { balance: data.glowcoinBalance }) }]
      : []),
    {
      label: t('userEmailState'),
      value: t(data.isEmailVerified ? 'emailVerified' : 'emailNotVerified'),
    },
    { label: t('userRegistered'), value: when(data.createdAt) },
    { label: t('userLastLogin'), value: when(data.lastLoginAt) },
    { label: t('userLocale'), value: data.locale.toUpperCase() },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{data.email}</h1>
        <Link className={styles.link} href="/moderation/users">
          {t('backToUsers')}
        </Link>
      </div>

      {data.isBlocked ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>
          {t('userBlocked')}
          {data.banReason ? `: ${data.banReason}` : ''}
        </p>
      ) : null}
      {data.deletionRequestedAt ? (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>
          {t('userDeletionRequested', { date: when(data.deletionRequestedAt) })}
        </p>
      ) : null}

      <dl className={styles.userRows}>
        {rows.map((row) => (
          <div className={styles.userRow} key={row.label}>
            <dt className={styles.userLabel}>{row.label}</dt>
            <dd className={styles.userValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <h2 className={styles.userSection}>
        {t('userProfilesTitle', { count: data.profiles.length })}
      </h2>

      {data.profiles.length === 0 ? (
        <p className={styles.empty}>{t('userNoProfiles')}</p>
      ) : (
        <div className={styles.staffList}>
          {data.profiles.map((profile) => (
            <div className={styles.staffRow} key={profile.id}>
              <div className={styles.staffMain}>
                <span className={styles.staffEmail}>{profile.displayName}</span>
                <span className={styles.staffMeta}>
                  {profile.cityName} · {t(`profileStatus_${profile.status}`)}
                  {profile.isVerified ? ` · ${t('identityBadge')}` : ''}
                  {profile.isFeatured ? ` · ${t('userInTop')}` : ''}
                </span>
              </div>
              <div className={styles.cardActions} style={{ padding: 0 }}>
                <Link className={styles.link} href={`/moderation/profiles/${profile.id}`}>
                  {t('openProfile')}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
