'use client';

import { adjustBalanceInputSchema, type ManagedUser, type UserRole } from '@noova/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { adjustBalance, BillingError } from '@/modules/billing/api';
import {
  blockUser,
  deleteUser,
  fetchUsers,
  unblockUser,
  verifyUserEmail,
} from '@/modules/moderation/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { LoadMore } from '../LoadMore';
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
  const { user: me } = useSession();
  // Корректировка баланса — только админу: это движение денег, а не модерация.
  const isAdmin = me?.role === 'admin';
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

  // Кому правим баланс: id открывает форму у этой строки. Итог показываем
  // там же — админ должен увидеть новый баланс, не перезагружая список.
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [adjusted, setAdjusted] = useState<{ userId: string; balanceGc: number } | null>(null);

  // Кого удаляем: подтверждение раскрывается у строки, а не в модальном окне —
  // так же, как причина блокировки.
  const [deleting, setDeleting] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: queryKeys.users(debounced, blockedOnly, role || undefined),
    queryFn: ({ pageParam }) =>
      fetchUsers(debounced || undefined, blockedOnly, role || undefined, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
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

  const adjustInput = (user: ManagedUser) =>
    adjustBalanceInputSchema.safeParse({
      userId: user.id,
      gcAmount: Number(amount),
      note: note.trim(),
    });

  const adjust = useMutation({
    mutationFn: (user: ManagedUser) => {
      const parsed = adjustInput(user);
      if (!parsed.success) throw new Error('invalid');
      return adjustBalance(parsed.data);
    },
    onSuccess: async (result, user) => {
      setAdjusting(null);
      setAmount('');
      setNote('');
      setAdjusted({ userId: user.id, balanceGc: result.balanceGc });
      await invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (user: ManagedUser) => deleteUser(user.id),
    onSuccess: async () => {
      setDeleting(null);
      await invalidate();
    },
  });

  const users = list.data ? list.data.pages.flatMap((page) => page.items) : null;
  const total = list.data?.pages[0]?.total ?? null;
  const busy =
    verify.isPending ||
    block.isPending ||
    unblock.isPending ||
    adjust.isPending ||
    remove.isPending;
  const error =
    adjust.isError && adjust.error instanceof BillingError && adjust.error.status === 409
      ? 'adjustInsufficient'
      : verify.isError || block.isError || unblock.isError || adjust.isError || remove.isError
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
                  {/* Почта — ссылка: страница отвечает на «что у него»,
                      список отвечает на «кто это». */}
                  <Link className={styles.staffEmail} href={`/moderation/users/${user.id}`}>
                    {user.email}
                  </Link>
                  <span className={styles.staffMeta}>
                    {user.nickname ? `${user.nickname} · ` : ''}
                    {user.role} · {t('userProfiles', { count: user.profileCount })}
                    {user.role === 'advertiser'
                      ? ` · ${t('balanceGc', { balance: user.glowcoinBalance })}`
                      : ''}
                    {user.bannedAt ? ` · ${new Date(user.bannedAt).toLocaleDateString()}` : ''}
                  </span>
                  {/* Причина видна в таблице: иначе непонятно, за что человек
                      заблокирован, и разблокировать приходится вслепую. */}
                  {user.banReason ? (
                    <span className={styles.reportBody}>{user.banReason}</span>
                  ) : null}

                  {adjusted?.userId === user.id ? (
                    <span className={styles.hint}>
                      {t('adjustDone', { balance: adjusted.balanceGc })}
                    </span>
                  ) : null}

                  {adjusting === user.id ? (
                    <div className={styles.reasonBox}>
                      <label className={styles.label} htmlFor={`adjust-amount-${user.id}`}>
                        {t('adjustAmount')}
                      </label>
                      <input
                        className={styles.input}
                        id={`adjust-amount-${user.id}`}
                        inputMode="numeric"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="+100"
                      />
                      <span className={styles.hint}>{t('adjustAmountHint')}</span>
                      <label className={styles.label} htmlFor={`adjust-note-${user.id}`}>
                        {t('adjustNote')}
                      </label>
                      <textarea
                        className={styles.textarea}
                        id={`adjust-note-${user.id}`}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        minLength={3}
                      />
                      <span className={styles.hint}>{t('adjustNoteHint')}</span>
                      <div className={styles.cardActions} style={{ padding: 0 }}>
                        <Button
                          disabled={busy || !adjustInput(user).success}
                          onClick={() => adjust.mutate(user)}
                        >
                          {t('adjustSubmit')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setAdjusting(null)}
                        >
                          {t('cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {deleting === user.id ? (
                    <div className={styles.reasonBox}>
                      <span className={styles.hint}>{t('deleteUserHint')}</span>
                      <div className={styles.cardActions} style={{ padding: 0 }}>
                        <Button disabled={busy} onClick={() => remove.mutate(user)}>
                          {t('deleteUserConfirm')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setDeleting(null)}
                        >
                          {t('cancel')}
                        </Button>
                      </div>
                    </div>
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

                  {isAdmin && user.role === 'advertiser' && adjusting !== user.id ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setAdjusting(user.id);
                        setAdjusted(null);
                        setAmount('');
                        setNote('');
                      }}
                    >
                      {t('adjustGc')}
                    </Button>
                  ) : null}

                  {isAdmin && !isStaff && deleting !== user.id ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setDeleting(user.id);
                        setBlocking(null);
                        setAdjusting(null);
                      }}
                    >
                      {t('deleteUser')}
                    </Button>
                  ) : null}

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
          <LoadMore
            shown={users.length}
            total={total}
            hasMore={list.hasNextPage}
            loading={list.isFetchingNextPage}
            onMore={() => void list.fetchNextPage()}
          />
        </div>
      )}
    </>
  );
}
