'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { blockProfile, fetchModeratedProfile, unblockProfile } from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Moderation.module.css';

const euro = (cents: number | null) => (cents === null ? '—' : `${Math.round(cents / 100)} €`);

export function ProfileReview({ profileId }: { profileId: string }) {
  const t = useTranslations('moderation');
  const { user, status } = useSession();
  const router = useRouter();

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';

  const queryClient = useQueryClient();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');

  const review = useQuery({
    queryKey: queryKeys.moderatedProfile(profileId),
    queryFn: () => fetchModeratedProfile(profileId),
    enabled: status === 'authenticated' && isStaff,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.moderatedProfile(profileId) });
    // Блокировка закрывает жалобы на анкету и меняет счётчик в шапке.
    await queryClient.invalidateQueries({ queryKey: ['moderation-queue'], exact: false });
    await queryClient.invalidateQueries({ queryKey: queryKeys.queueCount() });
  };

  const block = useMutation({
    mutationFn: () => blockProfile(profileId, reason.trim()),
    onSuccess: async () => {
      setBlocking(false);
      setReason('');
      await refresh();
    },
  });

  const unblock = useMutation({
    mutationFn: () => unblockProfile(profileId),
    onSuccess: refresh,
  });

  const profile = review.data ?? null;
  const error = review.isError ? 'notFound' : null;
  const busy = block.isPending || unblock.isPending;

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isStaff) return <p className={styles.empty}>{t('onlyStaff')}</p>;
  if (error) return <p className={styles.empty}>{t(error)}</p>;
  if (!profile) return <p className={styles.empty}>{t('loading')}</p>;

  const params: [string, string][] = [
    [t('status'), profile.status],
    [t('owner'), profile.owner.email],
    ['', `${profile.cityName}${profile.districtName ? ` · ${profile.districtName}` : ''}`],
    ...(profile.age ? ([['age', String(profile.age)]] as [string, string][]) : []),
    ...(profile.heightCm ? ([['cm', String(profile.heightCm)]] as [string, string][]) : []),
    ...(profile.languages.length
      ? ([['lang', profile.languages.join(', ')]] as [string, string][])
      : []),
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>
          {t('profileTitle')}: {profile.displayName}
        </h1>
        <Link className={styles.link} href="/moderation">
          ← {t('back')}
        </Link>
      </div>

      {/* Блокировка анкеты — основная мера модератора: показ прекращается,
          но владелица видит причину, правит и отправляет на проверку заново.
          Учётная запись при этом не трогается, иначе исправить было бы нечем. */}
      {profile.status === 'banned' ? (
        <div className={`${styles.notice} ${styles.noticeError}`}>
          <p>{t('profileBlocked')}</p>
          <div className={styles.cardActions} style={{ padding: 0 }}>
            <Button variant="secondary" disabled={busy} onClick={() => unblock.mutate()}>
              {t('unblockProfile')}
            </Button>
          </div>
        </div>
      ) : blocking ? (
        <div className={styles.reasonBox}>
          <textarea
            className={styles.textarea}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('blockProfileReason')}
            minLength={5}
          />
          <span className={styles.hint}>{t('blockProfileHint')}</span>
          <div className={styles.cardActions} style={{ padding: 0 }}>
            <Button disabled={busy || reason.trim().length < 5} onClick={() => block.mutate()}>
              {t('blockProfile')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setBlocking(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.cardActions} style={{ padding: 0, marginBottom: 'var(--space5)' }}>
          <Button variant="secondary" disabled={busy} onClick={() => setBlocking(true)}>
            {t('blockProfile')}
          </Button>
        </div>
      )}

      {profile.photos.length > 0 ? (
        <div className={styles.list} style={{ marginBottom: 'var(--space5)' }}>
          {profile.photos.map((photo) => (
            <div className={styles.card} key={photo.id}>
              <div className={styles.cardPhoto}>
                {/* Ссылка на неодобренное фото подписанная и живёт минуты —
                    оптимизатор Next закэшировал бы её и отдавал битую. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" loading="lazy" />
                {!photo.isApproved ? (
                  <span className={`${styles.badge} ${styles.badgeBlocked}`}>
                    {t('photoPendingBadge')}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.staffList}>
        <div className={styles.staffRow}>
          <div className={styles.staffMain}>
            <span className={styles.staffEmail}>{t('params')}</span>
            <span className={styles.staffMeta}>{params.map(([, value]) => value).join(' · ')}</span>
          </div>
        </div>

        <div className={styles.staffRow}>
          <div className={styles.staffMain}>
            <span className={styles.staffEmail}>{t('description')}</span>
            <span className={styles.staffMeta}>
              {profile.description.trim() || t('noDescription')}
            </span>
          </div>
        </div>

        {profile.services.length > 0 ? (
          <div className={styles.staffRow}>
            <div className={styles.staffMain}>
              <span className={styles.staffEmail}>{t('services')}</span>
              <span className={styles.staffMeta}>
                {profile.services.map((service) => service.name).join(', ')}
              </span>
            </div>
          </div>
        ) : null}

        {profile.prices.length > 0 ? (
          <div className={styles.staffRow}>
            <div className={styles.staffMain}>
              <span className={styles.staffEmail}>{t('prices')}</span>
              <span className={styles.staffMeta}>
                {profile.prices
                  .map(
                    (p) =>
                      `${p.durationMinutes} мин — ${euro(p.incallCents)} / ${euro(p.outcallCents)}`,
                  )
                  .join(' · ')}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
