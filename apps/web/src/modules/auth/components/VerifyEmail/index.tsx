'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { verifyEmail } from '@/modules/auth/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../AuthForm.module.css';

type State = 'pending' | 'success' | 'failed' | 'no-token';

export function VerifyEmail({ token }: { token: string | null }) {
  const t = useTranslations('auth');

  /**
   * По смыслу это действие, а не чтение, но здесь оно запускается самим
   * открытием страницы. `useQuery` подходит лучше эффекта: он сам гасит
   * повторный вызов при двойном монтировании в строгом режиме — а токен
   * одноразовый, и второй вызов погасил бы только что подтверждённую
   * ссылку. Раньше от этого спасал ручной `useRef`-флаг.
   */
  const check = useQuery({
    queryKey: queryKeys.verifyEmail(token ?? ''),
    queryFn: () => verifyEmail(token ?? ''),
    enabled: token !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const state: State =
    token === null
      ? 'no-token'
      : check.isSuccess
        ? 'success'
        : check.isError
          ? 'failed'
          : 'pending';

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('verifyTitle')}</h1>

      {state === 'pending' ? <p className={styles.hint}>{t('verifyPending')}</p> : null}
      {state === 'success' ? <p className={styles.success}>{t('verifySuccess')}</p> : null}
      {state === 'failed' ? <p className={styles.error}>{t('verifyFailed')}</p> : null}
      {state === 'no-token' ? <p className={styles.error}>{t('verifyNoToken')}</p> : null}

      <div className={styles.footer}>
        <Link className={styles.link} href="/login">
          {t('submitLogin')}
        </Link>
      </div>
    </div>
  );
}
