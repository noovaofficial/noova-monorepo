'use client';

import { loginSchema } from '@noova/shared';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { errorKeyFor, login } from '@/modules/auth/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { type FieldErrors, validate } from '@/shared/validation';
import styles from '../AuthForm.module.css';
import { useSession } from '../SessionProvider';
import { safeNext, useRedirectSignedIn } from '../useRedirectSignedIn';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { refresh } = useSession();
  const params = useSearchParams();
  // Вошедшему на форме входа делать нечего — уводим его отсюда.
  const signedIn = useRedirectSignedIn();
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const input = {
      email: String(data.get('email')),
      password: String(data.get('password')),
    };

    // На входе проверяем только формат адреса: длину пароля здесь сверять
    // нельзя — правила могли поменяться, а старый пароль обязан работать.
    const checked = validate(loginSchema, input);
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      setErrorKey('fixErrors');
      return;
    }

    setPending(true);
    try {
      await login(input);
      // Подтягиваем пользователя до перехода, иначе шапка на новой странице
      // успеет отрисоваться анонимной.
      await refresh();
      // Возвращаем туда, откуда пришли: гость мог нажать сердце на анкете,
      // и высадка на главной заставила бы искать ту же анкету заново.
      router.push(safeNext(params.get('next')) ?? '/');
      router.refresh();
    } catch (error) {
      setErrorKey(errorKeyFor(error));
    } finally {
      setPending(false);
    }
  }

  // Редирект уже назначен эффектом — форму показывать не нужно.
  if (signedIn) return null;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('loginTitle')}</h1>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {errorKey ? <p className={styles.error}>{t(errorKey)}</p> : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            {t('email')}
          </label>
          <input
            className={`${styles.input} ${fieldErrors.email ? styles.inputError : ''}`}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.email)}
            required
          />
          {fieldErrors.email ? (
            <span className={styles.fieldError}>{t(fieldErrors.email)}</span>
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            {t('password')}
          </label>
          <input
            className={styles.input}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <Button type="submit" disabled={pending}>
          {t('submitLogin')}
        </Button>
      </form>

      <div className={styles.footer}>
        <span>
          {t('noAccount')}{' '}
          <Link className={styles.link} href="/register">
            {t('submitRegister')}
          </Link>
        </span>
        <Link className={styles.link} href="/reset-password">
          {t('forgotPassword')}
        </Link>
      </div>
    </div>
  );
}
