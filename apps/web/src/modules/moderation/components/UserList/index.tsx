'use client';

import type { ManagedUser, UserRole } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { blockUser, fetchUsers, unblockUser, verifyUserEmail } from '@/modules/moderation/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Moderation.module.css';

const ROLES: UserRole[] = ['client', 'advertiser', 'moderator', 'admin'];

export function UserList({
  blockedOnly = false,
  withRoleFilter = false,
}: {
  blockedOnly?: boolean;
  withRoleFilter?: boolean;
} = {}) {
  const t = useTranslations('moderation');
  const [query, setQuery] = useState('');
  // Пусто — все типы. В разделе «Все пользователи» это и есть исходное
  // состояние: сначала показать всех, потом дать сузить.
  const [role, setRole] = useState<UserRole | ''>('');
  // Пауза перед запросом: без неё каждый символ в поиске уходит на сервер.
  // Отложенное значение и есть часть ключа — так каждый поисковый запрос
  // получает свой кэш, а ответ на прежний не может лечь поверх нового.
  const [debounced, setDebounced] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Кого именно блокируем: id открывает поле причины у этой строки.
  const [blocking, setBlocking] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const list = useQuery({
    queryKey: queryKeys.users(debounced, blockedOnly, role || undefined),
    queryFn: () => fetchUsers(debounced || undefined, blockedOnly, role || undefined),
  });

  // Блокировка меняет и общий список, и таблицу заблокированных — гасим
  // всю группу, а не текущий ключ.
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['moderation-users'], exact: false });

  const verify = useMutation({
    mutationFn: (user: ManagedUser) => verifyUserEmail(user.id),
    onSuccess: invalidate,
  });

  const block = useMutation({
    mutationFn: (user: ManagedUser) => blockUser(user.id, reason.trim()),
    onSuccess: async () => {
      setBlocking(null);
      setReason('');
      await invalidate();
    },
  });

  const unblock = useMutation({
    mutationFn: (user: ManagedUser) => unblockUser(user.id),
    onSuccess: invalidate,
  });

  const users = list.data ?? null;
  const busy = verify.isPending || block.isPending || unblock.isPending;
  const error =
    verify.isError || block.isError || unblock.isError
      ? 'actionFailed'
      : list.isError
        ? 'loadFailed'
        : null;

  return (
    <>
      <p className={`${styles.notice} ${styles.noticeInfo}`}>
        {t(blockedOnly ? 'blockedNote' : 'verifyEmailNote')}
      </p>

      <div className={styles.filters}>
        <div className={styles.field} style={{ maxWidth: 360 }}>
          <input
            className={styles.input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchUsers')}
          />
        </div>

        {withRoleFilter ? (
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${role === '' ? styles.tabActive : ''}`}
              onClick={() => setRole('')}
            >
              {t('roleAll')}
            </button>
            {ROLES.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.tab} ${role === value ? styles.tabActive : ''}`}
                onClick={() => setRole(value)}
              >
                {t(`role_${value}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{t(error)}</p> : null}

      {users === null ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : users.length === 0 ? (
        <p className={styles.empty}>{t(blockedOnly ? 'blockedEmpty' : 'usersEmpty')}</p>
      ) : (
        <div className={styles.staffList}>
          {users.map((user) => {
            const isStaff = user.role === 'moderator' || user.role === 'admin';
            return (
              <div className={styles.staffRow} key={user.id}>
                <div className={styles.staffMain}>
                  <span className={styles.staffEmail}>{user.email}</span>
                  <span className={styles.staffMeta}>
                    {user.nickname ? `${user.nickname} · ` : ''}
                    {user.role} · {t('userProfiles', { count: user.profileCount })}
                    {user.bannedAt ? ` · ${new Date(user.bannedAt).toLocaleDateString()}` : ''}
                  </span>
                  {/* Причина видна в таблице: иначе непонятно, за что человек
                      заблокирован, и разблокировать приходится вслепую. */}
                  {user.banReason ? (
                    <span className={styles.reportBody}>{user.banReason}</span>
                  ) : null}

                  {blocking === user.id ? (
                    <div className={styles.reasonBox}>
                      <textarea
                        className={styles.textarea}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={t('blockReason')}
                        minLength={5}
                      />
                      <span className={styles.hint}>{t('blockReasonHint')}</span>
                      <div className={styles.cardActions} style={{ padding: 0 }}>
                        <Button
                          disabled={busy || reason.trim().length < 5}
                          onClick={() => block.mutate(user)}
                        >
                          {t('blockUser')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setBlocking(null)}
                        >
                          {t('cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className={styles.cardActions} style={{ padding: 0 }}>
                  {user.isBlocked ? (
                    <>
                      <span className={`${styles.badge} ${styles.badgeBlocked}`}>
                        {t('userBlocked')}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => unblock.mutate(user)}
                      >
                        {t('unblockUser')}
                      </Button>
                    </>
                  ) : null}

                  {!user.isEmailVerified ? (
                    <>
                      <span className={`${styles.badge} ${styles.badgeBlocked}`}>
                        {t('emailNotVerified')}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => verify.mutate(user)}
                      >
                        {t('verifyEmail')}
                      </Button>
                    </>
                  ) : (
                    <span className={styles.badge}>{t('emailVerified')}</span>
                  )}

                  {/* Сотрудниками распоряжается админ через /admin/staff:
                      коллеги — не предмет модерации. */}
                  {!user.isBlocked && !isStaff && blocking !== user.id ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setBlocking(user.id);
                        setReason('');
                      }}
                    >
                      {t('blockUser')}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
