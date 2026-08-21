'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/design-system/components/Button';
import styles from './status.module.css';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('error');

  useEffect(() => {
    // digest — единственное, что связывает клиентскую ошибку с серверным логом.
    console.error('Ошибка рендера страницы', { digest: error.digest });
  }, [error]);

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.body}>{t('body')}</p>
      <Button onClick={reset}>{t('retry')}</Button>
    </div>
  );
}
