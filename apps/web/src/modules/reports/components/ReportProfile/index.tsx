'use client';

import { isUrgentReason, PROFILE_REPORT_REASONS, type ProfileReportReason } from '@noova/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { ReportError, reportProfile } from '@/modules/reports/api';
import styles from './ReportProfile.module.css';

const MIN_DETAILS = 10;

/**
 * Жалоба на анкету. Вход не требуется намеренно: заставлять регистрироваться
 * того, кто увидел признаки принуждения или несовершеннолетнюю, — значит
 * такого сообщения не получить. Спам сдерживается лимитом на стороне API.
 */
export function ReportProfile({ slug }: { slug: string }) {
  const t = useTranslations('reports');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ProfileReportReason>('underage');
  const [details, setDetails] = useState('');

  const send = useMutation({
    mutationFn: () => reportProfile(slug, { reason, details: details.trim() }),
    onSuccess: () => setDetails(''),
  });

  if (send.isSuccess) {
    return (
      <p className={`${styles.notice} ${styles.noticeOk}`}>
        {t(send.data.isUrgent ? 'sentUrgent' : 'sent')}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        {t('report')}
      </button>
    );
  }

  const tooManyRequests = send.error instanceof ReportError && send.error.status === 429;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <div>
        <label className={styles.label} htmlFor="report-reason">
          {t('reasonLabel')}
        </label>
        <select
          className={styles.select}
          id="report-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as ProfileReportReason)}
        >
          {PROFILE_REPORT_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(`reason_${value}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Срочные причины — не «важнее», а о возможном преступлении.
          Человек должен понимать, о чём сообщает. */}
      {isUrgentReason(reason) ? (
        <p className={`${styles.notice} ${styles.urgent}`}>{t('urgentNote')}</p>
      ) : null}

      <div>
        <label className={styles.label} htmlFor="report-details">
          {t('detailsLabel')}
        </label>
        <textarea
          className={styles.textarea}
          id="report-details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder={t('detailsPlaceholder')}
          maxLength={1000}
          required
        />
      </div>

      {send.isError ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>
          {t(tooManyRequests ? 'limit' : 'failed')}
        </p>
      ) : null}

      <p className={styles.note}>{t('anonymousNote')}</p>

      <div className={styles.foot}>
        <button type="button" className={styles.trigger} onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
        <Button type="submit" disabled={send.isPending || details.trim().length < MIN_DETAILS}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
