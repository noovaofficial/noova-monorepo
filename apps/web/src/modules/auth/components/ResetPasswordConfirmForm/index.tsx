'use client';

import { passwordSchema } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { confirmPasswordReset, errorKeyFor } from '@/modules/auth/api';
import { Link } from '@/shared/i18n/navigation';
import { type FieldErrors, validate } from '@/shared/validation';
import styles from '../AuthForm.module.css';

export function ResetPasswordConfirmForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setFieldErrors({});

    const password = String(new FormData(event.currentTarget).get('password'));

    const checked = validate(passwordSchema, password);
    if (!checked.ok) {
      setFieldErrors({ password: 'validationPasswordShort' });
      setErrorKey('fixErrors');
      return;
    }

    setPending(true);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (error) {
      // 400 здесь означает протухший или уже использованный токен,
      // а не проблему с самим паролем — его мы уже проверили выше.
      setErrorKey(
        errorKeyFor(error) === 'errorRateLimited' ? 'errorRateLimited' : 'resetTokenInvalid',
      );
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>{t('resetConfirmTitle')}</h1>
        <p className={styles.success}>{t('resetSuccess')}</p>
        <div className={styles.footer}>
          <Link className={styles.link} href="/login">
            {t('submitLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('resetConfirmTitle')}</h1>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {errorKey ? <p className={styles.error}>{t(errorKey)}</p> : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            {t('newPassword')}
          </label>
          <input
            className={`${styles.input} ${fieldErrors.password ? styles.inputError : ''}`}
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.password)}
            required
          />
          {fieldErrors.password ? (
            <span className={styles.fieldError}>{t(fieldErrors.password)}</span>
          ) : (
            <span className={styles.hint}>{t('passwordHint')}</span>
          )}
        </div>

        <Button type="submit" disabled={pending}>
          {t('resetConfirmSubmit')}
        </Button>
        <span className={styles.hint}>{t('resetLogoutNote')}</span>
      </form>
    </div>
  );
}
