'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { Logo } from '@/design-system/components/Logo';
import { applyStoredAdult, confirmAdult } from '@/layout/age-gate';
import styles from './AgeGate.module.css';

/**
 * Возрастной гейт 18+. Состояние намеренно не читается при инициализации:
 * при статическом рендере куки нет, и любое чтение на клиенте разошлось бы
 * с SSR-разметкой. Уже подтверждённый гейт прячет CSS по атрибуту,
 * который выставил инлайн-скрипт в <head>.
 */
export function AgeGate() {
  const t = useTranslations('ageGate');
  const [denied, setDenied] = useState(false);

  // Та же причина, что и у темы: после смены языка атрибут нужно вернуть,
  // иначе гейт всплывает повторно у того, кто уже подтвердил возраст.
  useEffect(() => applyStoredAdult(), []);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
    >
      <div className={styles.dialog}>
        <div className={styles.logo}>
          <Logo size={26} />
        </div>

        {denied ? (
          <p className={`${styles.body} ${styles.denied}`}>{t('denied')}</p>
        ) : (
          <>
            <h2 className={styles.title} id="age-gate-title">
              {t('title')}
            </h2>
            <p className={styles.body}>{t('body')}</p>
            <div className={styles.actions}>
              <Button onClick={confirmAdult}>{t('confirm')}</Button>
              <Button variant="secondary" onClick={() => setDenied(true)}>
                {t('deny')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
