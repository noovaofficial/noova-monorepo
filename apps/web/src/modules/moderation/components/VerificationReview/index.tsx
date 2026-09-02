'use client';

import { VERIFICATION_PHOTO_KINDS } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { approveIdentity, fetchVerification, rejectIdentity } from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Moderation.module.css';
import { PhotoViewer } from '../PhotoViewer';

/**
 * Заявка на верификацию личности целиком (D-12): три снимка и решение.
 *
 * Снимки грузятся с API по сессии, минуя оптимизатор Next: у него свой кэш
 * на диске, и документ осел бы там в открытом виде.
 */
export function VerificationReview({ requestId }: { requestId: string }) {
  const t = useTranslations('moderation');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  // Открытый снимок. null — закрыто; индекс, а не url, чтобы работали стрелки.
  const [viewing, setViewing] = useState<number | null>(null);

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';
  const item = useQuery({
    queryKey: queryKeys.verification(requestId),
    queryFn: () => fetchVerification(requestId),
    enabled: status === 'authenticated' && isStaff,
  });

  const refresh = async () => {
    setRejecting(false);
    setReason('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.verification(requestId) }),
      queryClient.invalidateQueries({ queryKey: ['verifications'], exact: false }),
      queryClient.invalidateQueries({ queryKey: queryKeys.queueCount() }),
    ]);
  };

  const approve = useMutation({ mutationFn: () => approveIdentity(requestId), onSuccess: refresh });
  const reject = useMutation({
    mutationFn: () => rejectIdentity(requestId, reason.trim()),
    onSuccess: refresh,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isStaff) return <p className={styles.empty}>{t('onlyStaff')}</p>;
  if (item.isError) return <p className={styles.empty}>{t('loadFailed')}</p>;
  if (!item.data) return <p className={styles.empty}>{t('loading')}</p>;

  const data = item.data;
  const busy = approve.isPending || reject.isPending;
  const decided = data.status !== 'pending';

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{data.profile.displayName}</h1>
        <Link className={styles.link} href="/moderation?tab=identity">
          {t('backToQueue')}
        </Link>
      </div>

      <p className={styles.cardMeta}>
        {data.profile.cityName} · {data.ownerEmail} ·{' '}
        {format.dateTime(new Date(data.submittedAt), {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </p>

      {data.status === 'approved' ? (
        <p className={`${styles.notice} ${styles.noticeInfo}`}>{t('identityApproved')}</p>
      ) : null}
      {data.status === 'rejected' ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>
          {t('identityRejected')}
          {data.rejectionReason ? `: ${data.rejectionReason}` : ''}
        </p>
      ) : null}

      {approve.isError || reject.isError ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('actionFailed')}</p>
      ) : null}

      {data.isPurged ? (
        <p className={`${styles.notice} ${styles.noticeInfo}`}>{t('identityPurged')}</p>
      ) : (
        <div className={styles.identityPhotos}>
          {VERIFICATION_PHOTO_KINDS.map((kind, index) => (
            <figure className={styles.identityPhoto} key={kind}>
              {/* Снимок целиком — кнопкой: в сетке документ не прочитать,
                  а решение принимают именно по надписям в нём. */}
              <button
                type="button"
                className={styles.identityOpenPhoto}
                onClick={() => setViewing(index)}
                aria-label={t('photoOpen')}
              >
                {/* Ссылка подписана сессией и живёт минуты: оптимизатор Next
                    закэшировал бы документ на диске — здесь это недопустимо. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.photos[kind]} alt="" />
              </button>
              <figcaption className={styles.identityCaption}>{t(`identity_${kind}`)}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {viewing !== null ? (
        <PhotoViewer
          photos={VERIFICATION_PHOTO_KINDS.map((kind) => ({
            url: data.photos[kind] ?? '',
            caption: t(`identity_${kind}`),
          }))}
          index={viewing}
          onClose={() => setViewing(null)}
          onStep={(delta) =>
            setViewing((current) =>
              current === null
                ? null
                : (current + delta + VERIFICATION_PHOTO_KINDS.length) %
                  VERIFICATION_PHOTO_KINDS.length,
            )
          }
        />
      ) : null}

      {!decided ? (
        <div className={styles.cardActions} style={{ padding: 0 }}>
          {rejecting ? (
            <div className={styles.reasonBox}>
              <textarea
                className={styles.textarea}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('identityRejectReason')}
                minLength={5}
              />
              <span className={styles.hint}>{t('identityRejectHint')}</span>
              <div className={styles.cardActions} style={{ padding: 0 }}>
                <Button disabled={busy || reason.trim().length < 5} onClick={() => reject.mutate()}>
                  {t('reject')}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setRejecting(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button disabled={busy} onClick={() => approve.mutate()}>
                {t('identityApprove')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
                {t('reject')}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
