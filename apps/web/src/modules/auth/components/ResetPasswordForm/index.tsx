'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { errorKeyFor, requestPasswordReset } from '@/modules/auth/api';
import { Link } from '@/shared/i18n/navigation';
import styles from '../AuthForm.module.css';

export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    try {
      await requestPasswordReset(String(data.get('email')));
      // Показываем один и тот же текст независимо от результата: он не должен
      // подсказывать, зарегистрирован адрес или нет.
      setSent(true);
    } catch (error) {
      setErrorKey(errorKeyFor(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('resetTitle')}</h1>

      {sent ? (
        <p className={styles.success}>{t('resetSent')}</p>
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {errorKey ? <p className={styles.error}>{t(errorKey)}</p> : null}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              {t('email')}
            </label>
            <input
              className={styles.input}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {t('resetSubmit')}
          </Button>
        </form>
      )}

      <div className={styles.footer}>
        <Link className={styles.link} href="/login">
          {t('submitLogin')}
        </Link>
      </div>
    </div>
  );
}
