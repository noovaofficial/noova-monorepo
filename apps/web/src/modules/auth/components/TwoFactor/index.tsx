'use client';

import type { CurrentUser, MfaSetup } from '@noova/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { enableMfa, errorKeyFor, startMfaSetup, verifyMfa } from '@/modules/auth/api';
import { applyStoredSessionHint } from '@/modules/auth/session-hint';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../AuthForm.module.css';
import { useSession } from '../SessionProvider';
import own from './TwoFactor.module.css';

/** Куда идёт сотрудник после второго фактора — туда же, куда ведёт proxy.ts. */
const STAFF_HOME = '/moderation';

/**
 * Второй фактор админов и модераторов. Три состояния, их задаёт сервер
 * (`user.twoFactor`), а не эта страница:
 *
 *  - `pending` — фактор настроен, ждём код из приложения или резервный;
 *  - `setup` — фактора ещё нет: показываем QR, подтверждаем первым кодом и
 *    один раз показываем резервные коды;
 *  - `ok` — здесь делать нечего, уводим в модерацию.
 *
 * Пока состояние не `ok`, сервер не отдаёт этой сессии ничего, кроме
 * маршрутов самой страницы, — обойти её, открыв другой адрес, нельзя.
 */
export function TwoFactor() {
  const t = useTranslations('auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, status, signOut } = useSession();

  const [setup, setSetup] = useState<MfaSetup | null>(null);
  // Резервные коды живут только в памяти этой страницы: сервер отдаёт их
  // один раз и у себя хранит хэши.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const showingCodes = recoveryCodes !== null;

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    // Пока показаны резервные коды, не уводим: их больше нигде не увидеть.
    else if (status === 'authenticated' && user?.twoFactor === 'ok' && !showingCodes) {
      router.replace(user.role === 'admin' || user.role === 'moderator' ? STAFF_HOME : '/');
    }
  }, [status, user, showingCodes, router]);

  /** Сервер уже выдал полноправную сессию и куку роли — догоняем интерфейс. */
  function accept(next: CurrentUser) {
    queryClient.setQueryData(queryKeys.session(), next);
    applyStoredSessionHint();
  }

  async function run(action: () => Promise<void>) {
    setErrorKey(null);
    setPending(true);
    try {
      await action();
    } catch (error) {
      setErrorKey(errorKeyFor(error));
    } finally {
      setPending(false);
    }
  }

  function codeFrom(event: React.FormEvent<HTMLFormElement>): string {
    event.preventDefault();
    return String(new FormData(event.currentTarget).get('code')).trim();
  }

  if (status !== 'authenticated' || !user) return null;

  if (recoveryCodes) {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>{t('twoFactorRecoveryTitle')}</h1>
        <p className={styles.success}>{t('twoFactorEnabled')}</p>
        <p className={own.text}>{t('twoFactorRecoveryIntro')}</p>
        <ul className={own.codes}>
          {recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button
          onClick={() => {
            setRecoveryCodes(null);
            router.replace(STAFF_HOME);
            router.refresh();
          }}
        >
          {t('twoFactorRecoveryDone')}
        </Button>
      </div>
    );
  }

  if (user.twoFactor === 'ok') return null;

  const footer = (
    <div className={styles.footer}>
      <button type="button" className={own.linkButton} onClick={() => void signOut()}>
        {t('twoFactorSignOut')}
      </button>
    </div>
  );

  if (user.twoFactor === 'setup') {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>{t('twoFactorSetupTitle')}</h1>
        {errorKey ? <p className={styles.error}>{t(errorKey)}</p> : null}

        {!setup ? (
          <div className={styles.form}>
            <p className={own.text}>{t('twoFactorSetupIntro')}</p>
            {/* По кнопке, а не при открытии: каждый запрос выдаёт новый секрет,
                и повторный вызов эффекта обесценил бы уже показанный QR. */}
            <Button
              disabled={pending}
              onClick={() => run(async () => setSetup(await startMfaSetup()))}
            >
              {t('twoFactorStart')}
            </Button>
          </div>
        ) : (
          <form
            className={styles.form}
            noValidate
            onSubmit={(event) => {
              const code = codeFrom(event);
              void run(async () => {
                const result = await enableMfa(code);
                accept(result.user);
                setRecoveryCodes(result.recoveryCodes);
              });
            }}
          >
            <p className={own.text}>{t('twoFactorScan')}</p>
            {/* biome-ignore lint/performance/noImgElement: data-URL от сервера, оптимизатору Next с ним делать нечего */}
            <img className={own.qr} src={setup.qrDataUrl} alt="" width={240} height={240} />
            <p className={own.text}>
              {t('twoFactorManual')} <code className={own.secret}>{setup.secret}</code>
            </p>
            <CodeField label={t('twoFactorCode')} hint={t('twoFactorSetupCodeHint')} digitsOnly />
            <Button type="submit" disabled={pending}>
              {t('twoFactorConfirm')}
            </Button>
          </form>
        )}
        {footer}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('twoFactorTitle')}</h1>
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          const code = codeFrom(event);
          void run(async () => {
            const result = await verifyMfa(code);
            accept(result.user);
            router.replace(STAFF_HOME);
            router.refresh();
          });
        }}
      >
        {errorKey ? <p className={styles.error}>{t(errorKey)}</p> : null}
        <CodeField label={t('twoFactorCode')} hint={t('twoFactorCodeHint')} />
        <Button type="submit" disabled={pending}>
          {t('twoFactorVerify')}
        </Button>
      </form>
      {footer}
    </div>
  );
}

function CodeField({
  label,
  hint,
  digitsOnly = false,
}: {
  label: string;
  hint: string;
  digitsOnly?: boolean;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="mfa-code">
        {label}
      </label>
      <input
        className={styles.input}
        id="mfa-code"
        name="code"
        // Резервный код содержит буквы, поэтому цифровая клавиатура — только
        // на настройке, где вводится именно код из приложения.
        inputMode={digitsOnly ? 'numeric' : 'text'}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={20}
        required
        // biome-ignore lint/a11y/noAutofocus: на странице одно поле, и ради него её открыли
        autoFocus
      />
      <span className={styles.hint}>{hint}</span>
    </div>
  );
}
