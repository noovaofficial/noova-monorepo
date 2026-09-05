'use client';

import { useMutation } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import {
  AuthError,
  cancelAccountDeletion,
  changePassword,
  requestAccountDeletion,
} from '@/modules/auth/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { useRouter } from '@/shared/i18n/navigation';
import styles from './AccountSettings.module.css';

/**
 * Настройки учётной записи: адрес и удаление. Страница заведена
 * отдельно, потому что удаление не должно жить среди анкет и избранного,
 * где на него нажимают мимоходом.
 */
export function AccountSettings() {
  const t = useTranslations('settings');
  // Даты — через форматтер next-intl: `toLocaleDateString()` без локали берёт
  // язык системы, и на русской странице показывал «1/15/2027».
  const format = useFormatter();
  const { user, status, refresh, signOut } = useSession();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const request = useMutation({
    mutationFn: () => requestAccountDeletion({ password }),
    onSuccess: async () => {
      setPassword('');
      setOpen(false);
      await refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: cancelAccountDeletion,
    onSuccess: () => refresh(),
  });

  const changePw = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: async () => {
      // Сервер погасил все сессии, включая эту, — своя очистка кэша и куки
      // та же, что при обычном выходе, дублировать её незачем.
      await signOut();
      router.push('/login');
    },
  });

  if (status === 'loading') return null;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  // Сотрудников заводит и убирает администратор: самоудаление оставило бы
  // раздел без модератора, и сервер такой запрос всё равно отклоняет.
  const isStaff = user?.role === 'moderator' || user?.role === 'admin';

  const pending = user?.deletionRequestedAt !== null && user?.deletionRequestedAt !== undefined;
  const effective = user?.deletionEffectiveAt
    ? format.dateTime(new Date(user.deletionEffectiveAt), { dateStyle: 'long' })
    : null;

  const wrongPassword = request.error instanceof AuthError && request.error.status === 401;
  const wrongCurrentPassword = changePw.error instanceof AuthError && changePw.error.status === 401;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('accountTitle')}</h2>
        <p className={styles.meta}>{user?.email}</p>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('passwordTitle')}</h2>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            changePw.mutate();
          }}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor="current-password">
              {t('passwordCurrent')}
            </label>
            <input
              className={styles.input}
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-password">
              {t('passwordNew')}
            </label>
            <input
              className={styles.input}
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
            <span className={styles.meta}>{t('passwordHint')}</span>
          </div>

          {changePw.isError ? (
            <p className={`${styles.notice} ${styles.noticeError}`}>
              {t(wrongCurrentPassword ? 'passwordWrongCurrent' : 'passwordFailed')}
            </p>
          ) : null}

          <Button type="submit" disabled={changePw.isPending}>
            {t('passwordSubmit')}
          </Button>
        </form>
      </div>

      {isStaff ? null : (
        <div className={`${styles.section} ${styles.danger}`}>
          <h2 className={styles.sectionTitle}>{t('deleteTitle')}</h2>

          {pending ? (
            <>
              <p className={`${styles.notice} ${styles.noticeWarn}`}>
                {t('deletePending', { date: effective ?? '' })}
              </p>
              <p className={styles.text}>{t('deletePendingHint')}</p>
              <Button disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                {t('deleteCancel')}
              </Button>
            </>
          ) : (
            <>
              <p className={styles.text}>{t('deleteWhat')}</p>
              <ul className={styles.list}>
                <li>{t('deleteItemProfiles')}</li>
                <li>{t('deleteItemPhotos')}</li>
                <li>{t('deleteItemComments')}</li>
                <li>{t('deleteItemFavorites')}</li>
              </ul>
              {/* Про журнал модерации говорим прямо: он переживает удаление,
                  и умолчать об этом значило бы обмануть. */}
              <p className={styles.text}>{t('deleteKeeps')}</p>

              {open ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    request.mutate();
                  }}
                >
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="delete-password">
                      {t('deletePassword')}
                    </label>
                    <input
                      className={styles.input}
                      id="delete-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>

                  {request.isError ? (
                    <p className={`${styles.notice} ${styles.noticeError}`}>
                      {t(wrongPassword ? 'deleteWrongPassword' : 'deleteFailed')}
                    </p>
                  ) : null}

                  <div className={styles.actions}>
                    <Button type="submit" disabled={request.isPending || password.length === 0}>
                      {t('deleteConfirm')}
                    </Button>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => {
                        setOpen(false);
                        setPassword('');
                      }}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  {t('deleteStart')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
