'use client';

import type { StaffMember } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  createStaff,
  fetchStaff,
  ModerationError,
  setStaffBlocked,
} from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Moderation.module.css';

export function StaffManager() {
  const t = useTranslations('admin');
  const { user, status } = useSession();
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin';

  const list = useQuery({
    queryKey: queryKeys.staff(),
    queryFn: fetchStaff,
    enabled: status === 'authenticated' && isAdmin,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.staff() });

  const create = useMutation({
    mutationFn: createStaff,
    onSuccess: async () => {
      setShowForm(false);
      await invalidate();
    },
  });

  const block = useMutation({
    mutationFn: (member: StaffMember) => setStaffBlocked(member.id, !member.isBlocked),
    onSuccess: invalidate,
  });

  const staff = list.data ?? null;
  const busy = create.isPending || block.isPending;
  // 409 на создании — занятый адрес, а не сбой: сообщение должно называть
  // причину, иначе админ будет пробовать тот же адрес снова.
  const error =
    create.error instanceof ModerationError && create.error.status === 409
      ? 'emailTaken'
      : create.isError || block.isError || list.isError
        ? 'createFailed'
        : null;

  if (status === 'loading') return <p className={styles.empty}>…</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    create.mutate({
      email: String(data.get('email')).trim(),
      password: String(data.get('password')),
      role: String(data.get('role')) as 'moderator' | 'admin',
    });
  }

  const toggleBlock = (member: StaffMember) => block.mutate(member);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
        <Link className={styles.link} href="/moderation/log">
          {t('logTitle')}
        </Link>
        {!showForm ? <Button onClick={() => setShowForm(true)}>{t('add')}</Button> : null}
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{t(error)}</p> : null}

      {showForm ? (
        <form className={styles.form} onSubmit={onCreate}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="staff-email">
              {t('email')}
            </label>
            <input className={styles.input} id="staff-email" name="email" type="email" required />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="staff-password">
              {t('password')}
            </label>
            <input
              className={styles.input}
              id="staff-password"
              name="password"
              type="text"
              minLength={10}
              required
            />
            {/* Пароль виден намеренно: письмо не отправляется, админ должен
                передать его сотруднику лично. */}
            <span className={styles.hint}>{t('passwordHint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="staff-role">
              {t('role')}
            </label>
            <select className={styles.select} id="staff-role" name="role" defaultValue="moderator">
              <option value="moderator">{t('roleModerator')}</option>
              <option value="admin">{t('roleAdmin')}</option>
            </select>
          </div>

          <div className={styles.cardActions} style={{ padding: 0 }}>
            <Button type="submit" disabled={busy}>
              {t('create')}
            </Button>
            <Button variant="secondary" onClick={() => setShowForm(false)} disabled={busy}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      <div className={styles.staffList}>
        {(staff ?? []).map((member) => {
          const isSelf = member.id === user?.id;
          return (
            <div className={styles.staffRow} key={member.id}>
              <div className={styles.staffMain}>
                <span className={styles.staffEmail}>{member.email}</span>
                <span className={styles.staffMeta}>
                  {t('decisions', { count: member.decisionCount })} ·{' '}
                  {member.lastLoginAt
                    ? t('lastLogin', {
                        date: new Date(member.lastLoginAt).toLocaleDateString(),
                      })
                    : t('neverLoggedIn')}
                </span>
              </div>

              <div className={styles.cardActions} style={{ padding: 0 }}>
                <span
                  className={`${styles.badge} ${member.role === 'admin' ? styles.badgeAdmin : ''}`}
                >
                  {member.role === 'admin' ? t('roleAdmin') : t('roleModerator')}
                </span>
                {member.isBlocked ? (
                  <span className={`${styles.badge} ${styles.badgeBlocked}`}>{t('blocked')}</span>
                ) : null}

                <Button
                  variant="secondary"
                  disabled={busy || isSelf}
                  title={isSelf ? t('selfBlockNote') : undefined}
                  onClick={() => toggleBlock(member)}
                >
                  {member.isBlocked ? t('unblock') : t('block')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
