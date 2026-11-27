'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AuthError, resendVerificationEmail } from '@/modules/auth/api';
import styles from './ResendVerification.module.css';

/**
 * «Отправить письмо ещё раз» — рядом с каждым напоминанием о неподтверждённой
 * почте. Без неё человеку, до которого не дошло первое письмо, оставалось
 * только писать в поддержку.
 */
export function ResendVerification() {
  const t = useTranslations('auth');
  const resend = useMutation({ mutationFn: resendVerificationEmail });

  if (resend.isSuccess) {
    return (
      <span className={styles.note} role="status">
        {t('resendSent')}
      </span>
    );
  }

  const error = resend.error;
  return (
    <>
      <button
        type="button"
        className={styles.link}
        onClick={() => resend.mutate()}
        disabled={resend.isPending}
      >
        {t('resendVerification')}
      </button>
      {error ? (
        <span className={styles.note} role="alert">
          {t(error instanceof AuthError && error.status === 429 ? 'resendWait' : 'resendFailed')}
        </span>
      ) : null}
    </>
  );
}
