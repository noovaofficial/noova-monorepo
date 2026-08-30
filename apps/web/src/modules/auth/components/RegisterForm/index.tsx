'use client';

import {
  type AdvertiserKind,
  type Locale,
  type RegisterInput,
  registerAdvertiserSchema,
  registerClientSchema,
} from '@noova/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { AuthError, errorKeyFor, register } from '@/modules/auth/api';
import { Link } from '@/shared/i18n/navigation';
import { type FieldErrors, fieldErrorsFromIssues, validate } from '@/shared/validation';
import styles from '../AuthForm.module.css';
import { useRedirectSignedIn } from '../useRedirectSignedIn';

type Role = 'client' | 'advertiser';

/**
 * Три типа размещения (N-31). Порядок — от простого к сложному: большинство
 * приходит за одной анкетой, и она должна быть первой.
 */
const ADVERTISER_KINDS: AdvertiserKind[] = ['individual', 'agency', 'salon'];

const KIND_LABEL: Record<AdvertiserKind, string> = {
  individual: 'advertiserIndividual',
  agency: 'advertiserAgency',
  salon: 'advertiserSalon',
};

const KIND_HINT: Record<AdvertiserKind, string> = {
  individual: 'advertiserIndividualHint',
  agency: 'advertiserAgencyHint',
  salon: 'advertiserSalonHint',
};

export function RegisterForm() {
  const t = useTranslations('auth');
  // Локаль интерфейса уходит на сервер: ею отправляются письма.
  const locale = useLocale() as Locale;
  const [role, setRole] = useState<Role>('client');
  const [advertiserKind, setAdvertiserKind] = useState<AdvertiserKind>('individual');
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sent, setSent] = useState(false);
  // Вошедшему регистрироваться незачем — тот же случай, что и на входе.
  const signedIn = useRedirectSignedIn();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email'));
    const password = String(data.get('password'));

    // Пустые необязательные поля не отправляем вовсе: схема на бэке ждёт
    // либо валидное значение, либо отсутствие ключа, но не пустую строку.
    const optional = (key: string) => {
      const value = String(data.get(key) ?? '').trim();
      return value.length > 0 ? value : undefined;
    };

    const birthYearRaw = optional('birthYear');

    const input: RegisterInput =
      role === 'client'
        ? {
            role: 'client',
            email,
            password,
            nickname: String(data.get('nickname')).trim(),
            ...(optional('name') ? { name: optional('name') } : {}),
            ...(birthYearRaw ? { birthYear: Number(birthYearRaw) } : {}),
            ...(optional('gender')
              ? { gender: optional('gender') as 'male' | 'female' | 'other' }
              : {}),
            // Язык интерфейса, а не браузера: письма должны прийти на том
            // языке, на котором человек сейчас смотрит сайт.
            locale,
          }
        : { role: 'advertiser', email, password, advertiserKind, locale };

    // Проверяем тем же контрактом, что и сервер: пользователь видит причину
    // сразу и под нужным полем, а не общее «не удалось» после запроса.
    const checked =
      input.role === 'client'
        ? validate(registerClientSchema, input)
        : validate(registerAdvertiserSchema, input);

    if (!checked.ok) {
      setFieldErrors(checked.errors);
      setErrorKey('fixErrors');
      return;
    }

    setPending(true);
    try {
      await register(input);
      setSent(true);
    } catch (error) {
      const key = errorKeyFor(error);
      setErrorKey(key);
      // Занятый никнейм приходит только с сервера — подсвечиваем поле.
      if (key === 'errorNicknameTaken') {
        setFieldErrors({ nickname: 'errorNicknameTaken' });
      } else if (error instanceof AuthError && error.issues.length > 0) {
        setFieldErrors(fieldErrorsFromIssues(error.issues));
        setErrorKey('fixErrors');
      }
    } finally {
      setPending(false);
    }
  }

  const fieldError = (field: string) =>
    fieldErrors[field] ? (
      <span className={styles.fieldError} id={`${field}-error`}>
        {t(fieldErrors[field])}
      </span>
    ) : null;

  // Подтверждение отправки показываем всегда: регистрация сессию не создаёт,
  // но если бы создала — сообщение о письме важнее редиректа.
  if (sent) {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>{t('registerTitle')}</h1>
        <p className={styles.success}>{t('registerSent')}</p>
      </div>
    );
  }

  // Редирект уже назначен эффектом — форму показывать не нужно.
  if (signedIn) return null;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('registerTitle')}</h1>

      <div className={styles.roles}>
        <button
          type="button"
          className={`${styles.role} ${role === 'client' ? styles.roleActive : ''}`}
          onClick={() => setRole('client')}
          aria-pressed={role === 'client'}
        >
          {t('roleClient')}
        </button>
        <button
          type="button"
          className={`${styles.role} ${role === 'advertiser' ? styles.roleActive : ''}`}
          onClick={() => setRole('advertiser')}
          aria-pressed={role === 'advertiser'}
        >
          {t('roleAdvertiser')}
        </button>
      </div>

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
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            required
          />
          {fieldError('email')}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            {t('password')}
          </label>
          <input
            className={`${styles.input} ${fieldErrors.password ? styles.inputError : ''}`}
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            required
          />
          {fieldErrors.password ? (
            fieldError('password')
          ) : (
            <span className={styles.hint}>{t('passwordHint')}</span>
          )}
        </div>

        {role === 'advertiser' ? (
          <div className={styles.field}>
            <span className={styles.label}>{t('advertiserKind')}</span>
            <div className={styles.roles}>
              {ADVERTISER_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`${styles.role} ${advertiserKind === kind ? styles.roleActive : ''}`}
                  onClick={() => setAdvertiserKind(kind)}
                  aria-pressed={advertiserKind === kind}
                >
                  {t(KIND_LABEL[kind])}
                </button>
              ))}
            </div>
            <span className={styles.hint}>{t(KIND_HINT[advertiserKind])}</span>
          </div>
        ) : null}

        {role === 'client' ? (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="nickname">
                {t('nickname')}
              </label>
              <input
                className={`${styles.input} ${fieldErrors.nickname ? styles.inputError : ''}`}
                id="nickname"
                name="nickname"
                type="text"
                minLength={2}
                maxLength={24}
                aria-invalid={Boolean(fieldErrors.nickname)}
                aria-describedby={fieldErrors.nickname ? 'nickname-error' : undefined}
                required
              />
              {fieldErrors.nickname ? (
                fieldError('nickname')
              ) : (
                <span className={styles.hint}>{t('nicknameHint')}</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">
                {t('name')} <span className={styles.optional}>— {t('optional')}</span>
              </label>
              <input
                className={`${styles.input} ${fieldErrors.name ? styles.inputError : ''}`}
                id="name"
                name="name"
                type="text"
                maxLength={60}
              />
              {fieldError('name')}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="birthYear">
                {t('birthYear')} <span className={styles.optional}>— {t('optional')}</span>
              </label>
              <input
                className={`${styles.input} ${fieldErrors.birthYear ? styles.inputError : ''}`}
                id="birthYear"
                name="birthYear"
                type="number"
                inputMode="numeric"
                aria-invalid={Boolean(fieldErrors.birthYear)}
                aria-describedby={fieldErrors.birthYear ? 'birthYear-error' : undefined}
              />
              {fieldError('birthYear')}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="gender">
                {t('gender')} <span className={styles.optional}>— {t('optional')}</span>
              </label>
              <select className={styles.select} id="gender" name="gender" defaultValue="">
                <option value="">—</option>
                <option value="female">{t('genderFemale')}</option>
                <option value="male">{t('genderMale')}</option>
                <option value="other">{t('genderOther')}</option>
              </select>
            </div>
          </>
        ) : null}

        <Button type="submit" disabled={pending}>
          {t('submitRegister')}
        </Button>
      </form>

      <div className={styles.footer}>
        <span>
          {t('hasAccount')}{' '}
          <Link className={styles.link} href="/login">
            {t('submitLogin')}
          </Link>
        </span>
      </div>
    </div>
  );
}
