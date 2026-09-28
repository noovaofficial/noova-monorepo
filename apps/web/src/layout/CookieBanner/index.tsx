'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/design-system/components/Button';
import { setConsent } from '@/layout/cookie-consent';
import { Link } from '@/shared/i18n/navigation';
import styles from './CookieBanner.module.css';

/**
 * Баннер согласия (TDDDG §25). Простое да/нет — не отменяет сам сайт
 * (страница работает и без решения), только решает, сохранять ли
 * идентификатор клика рекламной сети (см. `cookie-consent.ts`). Прячется
 * CSS по атрибуту `data-consent`, который выставляет либо инлайн-скрипт
 * в <head> (уже решившим до первой отрисовки), либо `setConsent` здесь же
 * (без перезагрузки страницы).
 *
 * Не модальный оверлей, в отличие от возрастного гейта: страница не
 * блокируется, пока посетитель решает, — TDDDG требует спросить, не
 * задержать.
 */
export function CookieBanner() {
  const t = useTranslations('cookieBanner');

  return (
    <section className={styles.bar} aria-label={t('title')}>
      <p className={styles.text}>{t('body')}</p>
      <div className={styles.actions}>
        <Link href="/legal/cookies" className={styles.details}>
          {t('detailsLink')}
        </Link>
        <Button variant="secondary" onClick={() => setConsent('no')}>
          {t('decline')}
        </Button>
        <Button onClick={() => setConsent('yes')}>{t('accept')}</Button>
      </div>
    </section>
  );
}
