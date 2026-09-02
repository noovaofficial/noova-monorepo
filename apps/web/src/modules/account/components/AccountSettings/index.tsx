'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { AuthError, cancelAccountDeletion, requestAccountDeletion } from '@/modules/auth/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchListing } from '@/modules/billing/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './AccountSettings.module.css';

const ADVERTISER_LABEL = {
  individual: 'advertiserIndividual',
  salon: 'advertiserSalon',
  agency: 'advertiserAgency',
} as const;

/** Сколько полных суток осталось до даты. Ноль — если срок уже вышел. */
function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/**
 * Настройки учётной записи: срок подписки и удаление. Страница заведена
 * отдельно, потому что удаление не должно жить среди анкет и избранного,
 * где на него нажимают мимоходом.
 */
export function AccountSettings() {
  const t = useTranslations('settings');
  // Тип размещения подписан так же, как при регистрации: человек выбирал
  // его этими словами, и другой синоним здесь читался бы как другой тариф.
  const ta = useTranslations('auth');
  // Даты — через форматтер next-intl: `toLocaleDateString()` без локали берёт
  // язык системы, и на русской странице показывал «1/15/2027».
  const format = useFormatter();
  const { user, status, refresh } = useSession();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');

  const request = useMutation({
    mutationFn: () => requestAccountDeletion({ password }),
    onSuccess: async () => {
      setPassword('');
      setOpen(false);
      await refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: cancelAccountDeletion,
    onSuccess: () => refresh(),
  });

  // Текущее размещение — с сервера. `null`, пока ни одно не оплачено.
  const listing = useQuery({
    queryKey: queryKeys.listing(),
    queryFn: fetchListing,
    enabled: user?.role === 'advertiser',
  });

  if (status === 'loading') return null;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  // Сотрудников заводит и убирает администратор: самоудаление оставило бы
  // раздел без модератора, и сервер такой запрос всё равно отклоняет.
  const isStaff = user?.role === 'moderator' || user?.role === 'admin';

  const subscription = listing.data ?? null;

  const pending = user?.deletionRequestedAt !== null && user?.deletionRequestedAt !== undefined;
  const effective = user?.deletionEffectiveAt
    ? format.dateTime(new Date(user.deletionEffectiveAt), { dateStyle: 'long' })
    : null;

  const wrongPassword = request.error instanceof AuthError && request.error.status === 401;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('accountTitle')}</h2>
        <p className={styles.meta}>{user?.email}</p>
      </div>

      {user?.role === 'advertiser' ? (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('subscriptionTitle')}</h2>

          {subscription ? (
            <dl className={styles.rows}>
              {user.advertiserKind ? (
                <div className={styles.row}>
                  <dt className={styles.rowLabel}>{t('subscriptionPlan')}</dt>
                  <dd className={styles.rowValue}>{ta(ADVERTISER_LABEL[user.advertiserKind])}</dd>
                </div>
              ) : null}

              {/* Дата и остаток вместе: «до 15 января» без «осталось 12 дней»
                  требует считать в уме, а одни «12 дней» нечем проверить. */}
              <div className={styles.row}>
                <dt className={styles.rowLabel}>{t('subscriptionUntil')}</dt>
                <dd className={styles.rowValue}>
                  {format.dateTime(new Date(subscription.expiresAt), { dateStyle: 'long' })}
                  <span className={styles.rowHint}>
                    {' '}
                    · {t('subscriptionDaysLeft', { days: daysLeft(subscription.expiresAt) })}
                  </span>
                </dd>
              </div>

              {subscription.status !== 'active' ? (
                <div className={styles.row}>
                  <dt className={styles.rowLabel}>{t('subscriptionStatus')}</dt>
                  <dd className={styles.rowValue}>
                    {t(`subscriptionStatus_${subscription.status}`)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className={styles.text}>{t('subscriptionNone')}</p>
          )}

          <Link className={styles.rowLink} href="/account/glowcoin">
            {t('subscriptionWallet')}
          </Link>
        </div>
      ) : null}

      {isStaff ? null : (
        <div className={`${styles.section} ${styles.danger}`}>
          <h2 className={styles.sectionTitle}>{t('deleteTitle')}</h2>

          {pending ? (
            <>
              <p className={`${styles.notice} ${styles.noticeWarn}`}>
                {t('deletePending', { date: effective ?? '' })}
              </p>
              <p className={styles.text}>{t('deletePendingHint')}</p>
              <Button disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                {t('deleteCancel')}
              </Button>
            </>
          ) : (
            <>
              <p className={styles.text}>{t('deleteWhat')}</p>
              <ul className={styles.list}>
                <li>{t('deleteItemProfiles')}</li>
                <li>{t('deleteItemPhotos')}</li>
                <li>{t('deleteItemComments')}</li>
                <li>{t('deleteItemFavorites')}</li>
              </ul>
              {/* Про журнал модерации говорим прямо: он переживает удаление,
                  и умолчать об этом значило бы обмануть. */}
              <p className={styles.text}>{t('deleteKeeps')}</p>

              {open ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    request.mutate();
                  }}
                >
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="delete-password">
                      {t('deletePassword')}
                    </label>
                    <input
                      className={styles.input}
                      id="delete-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>

                  {request.isError ? (
                    <p className={`${styles.notice} ${styles.noticeError}`}>
                      {t(wrongPassword ? 'deleteWrongPassword' : 'deleteFailed')}
                    </p>
                  ) : null}

                  <div className={styles.actions}>
                    <Button type="submit" disabled={request.isPending || password.length === 0}>
                      {t('deleteConfirm')}
                    </Button>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => {
                        setOpen(false);
                        setPassword('');
                      }}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  {t('deleteStart')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
