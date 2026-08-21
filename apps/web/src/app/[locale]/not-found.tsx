'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/shared/i18n/navigation';
import styles from './status.module.css';

/**
 * Клиентский компонент намеренно: Next не передаёт params в not-found, поэтому
 * серверная локаль здесь недоступна и рендер падает. На клиенте перевод берётся
 * из NextIntlClientProvider, который уже стоит в layout.
 */
export default function NotFound() {
  const t = useTranslations('error');

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('notFoundTitle')}</h1>
      <p className={styles.body}>{t('notFoundBody')}</p>
      <Link href="/" className={styles.action}>
        {t('backHome')}
      </Link>
    </div>
  );
}
