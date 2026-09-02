'use client';

import { VERIFICATION_PHOTO_KINDS, type VerificationPhotoKind } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { AccountError, fetchOwnVerification, submitVerification } from '@/modules/account/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';

type Files = Partial<Record<VerificationPhotoKind, File>>;

/**
 * Верификация личности в редакторе анкеты (D-12).
 *
 * Бейдж «Проверено» и только он: публикацию верификация не открывает и не
 * закрывает — анкета живёт в каталоге и без неё.
 *
 * Три снимка одной формой: по лицу без документа решение не принять, а
 * догружать недостающее по одному значит держать полузаявку в очереди.
 */
export function VerificationCard({
  profileId,
  published,
}: {
  profileId: string;
  published: boolean;
}) {
  const t = useTranslations('account');
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<Files>({});
  const [open, setOpen] = useState(false);

  const state = useQuery({
    queryKey: queryKeys.ownVerification(profileId),
    queryFn: () => fetchOwnVerification(profileId),
  });

  const send = useMutation({
    mutationFn: () => submitVerification(profileId, files as Record<VerificationPhotoKind, File>),
    onSuccess: async () => {
      setFiles({});
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownVerification(profileId) });
    },
  });

  if (!state.data) return null;

  const status = state.data.status;
  const ready = VERIFICATION_PHOTO_KINDS.every((kind) => files[kind]);
  // Подать можно, пока анкета опубликована и заявка не ждёт решения и не
  // одобрена. Отказ — не тупик: снимки переснимают и подают заново.
  const canSubmit = published && status !== 'pending' && status !== 'approved';

  const errorKey =
    send.error instanceof AccountError && send.error.status === 400
      ? 'verifyBadFile'
      : send.isError
        ? 'verifyFailed'
        : null;

  return (
    <div className={styles.sidebarCard}>
      <span className={styles.sidebarTitle}>{t('verifyTitle')}</span>

      {status === 'approved' ? (
        <p className={`${styles.notice} ${styles.noticeOk}`} style={{ margin: 0 }}>
          {t('verifyApproved')}
        </p>
      ) : status === 'pending' ? (
        <p className={`${styles.notice} ${styles.noticeInfo}`} style={{ margin: 0 }}>
          {t('verifyPending')}
        </p>
      ) : status === 'rejected' ? (
        <p className={`${styles.notice} ${styles.noticeWarn}`} style={{ margin: 0 }}>
          {t('verifyRejected')}
          {state.data.rejectionReason ? `: ${state.data.rejectionReason}` : ''}
        </p>
      ) : null}

      {status !== 'approved' ? <p className={styles.hint}>{t('verifyWhat')}</p> : null}

      {!published && status !== 'approved' ? (
        <p className={styles.hint}>{t('verifyNeedsPublished')}</p>
      ) : null}

      {errorKey ? (
        <p className={`${styles.notice} ${styles.noticeError}`} style={{ margin: 0 }}>
          {t(errorKey)}
        </p>
      ) : null}

      {canSubmit && !open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('verifyStart')}
        </Button>
      ) : null}

      {canSubmit && open ? (
        <>
          {VERIFICATION_PHOTO_KINDS.map((kind) => (
            <div className={styles.field} key={kind}>
              <label className={styles.label} htmlFor={`verify-${kind}`}>
                {t(`verifyPhoto_${kind}`)}
              </label>
              <span className={styles.hint}>{t(`verifyHint_${kind}`)}</span>
              <input
                className={styles.input}
                id={`verify-${kind}`}
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setFiles((prev) => ({ ...prev, [kind]: event.target.files?.[0] }))
                }
              />
            </div>
          ))}

          <p className={styles.hint}>{t('verifyPrivacy')}</p>

          <div className={styles.sidebarActions}>
            <Button disabled={!ready || send.isPending} onClick={() => send.mutate()}>
              {t('verifySubmit')}
            </Button>
            <Button variant="secondary" disabled={send.isPending} onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
