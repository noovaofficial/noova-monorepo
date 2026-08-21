'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { CommentError, reportComment } from '@/modules/comments/api';
import styles from '../Comments.module.css';

/**
 * Жалоба на комментарий. Владелец анкеты не отвечает публично (решение 3
 * в planning.md) — это его единственный способ возразить, поэтому кнопка
 * есть у каждого вошедшего, а не только у владельца: закрывать её ролью
 * значило бы прятать сообщение о нарушении от тех, кто его заметил.
 */
export function CommentActions({ commentId }: { commentId: string }) {
  const t = useTranslations('comments');
  const { status } = useSession();
  const [state, setState] = useState<'idle' | 'form' | 'sent' | 'already'>('idle');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  // Отдельно от `state`: сбой не выводит из формы, её нужно показать снова
  // вместе с сообщением и уже набранным текстом.
  const [failed, setFailed] = useState(false);

  if (status !== 'authenticated') return null;

  if (state === 'sent' || state === 'already') {
    return (
      <p className={`${styles.notice} ${styles.noticeInfo}`}>
        {t(state === 'sent' ? 'reportSent' : 'reportAlready')}
      </p>
    );
  }

  if (state !== 'form') {
    return (
      <div className={styles.foot}>
        <button type="button" className={styles.reportBtn} onClick={() => setState('form')}>
          {t('report')}
        </button>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    try {
      await reportComment(commentId, { reason: reason.trim() });
      setState('sent');
    } catch (error) {
      // 409 — жалоба уже подана этим человеком, это не сбой.
      if (error instanceof CommentError && error.status === 409) setState('already');
      else setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <textarea
        className={styles.textarea}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t('reportPlaceholder')}
        minLength={5}
        maxLength={1000}
        required
      />
      {failed ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('reportFailed')}</p>
      ) : null}
      <div className={styles.formFoot}>
        <button
          type="button"
          className={styles.reportBtn}
          onClick={() => {
            setState('idle');
            setReason('');
          }}
        >
          {t('cancel')}
        </button>
        <button type="submit" className={styles.reportBtn} disabled={pending}>
          {t('reportSubmit')}
        </button>
      </div>
    </form>
  );
}
