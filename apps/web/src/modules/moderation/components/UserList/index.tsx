'use client';

import {
  type AdvertiserKind,
  adjustBalanceInputSchema,
  isAdjustWithinLimit,
  type ManagedUser,
  type UserRole,
} from '@noova/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { blockCompany, grantCompanyTop, unblockCompany } from '@/modules/agencies/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { adjustBalance, BillingError, fetchAdjustLimit } from '@/modules/billing/api';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import {
  blockProfile,
  blockUser,
  deleteUser,
  fetchUsers,
  grantProfileTop,
  unblockProfile,
  unblockUser,
  verifyUserEmail,
} from '@/modules/moderation/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { AdvertiserAnalyticsLink } from '../AdvertiserAnalytics';
import { BlockIcon, DeleteIcon, TopIcon, UnblockIcon, VerifyIcon } from '../icons';
import { LoadMore } from '../LoadMore';
import styles from '../Moderation.module.css';

const ROLES: UserRole[] = ['client', 'advertiser', 'moderator', 'admin'];

/**
 * Что именно банит «заблокировать» в списке: аккаунт (All users/Staff-поиск)
 * или сущность вкладки — анкета (Individuals/Massage salons) либо компания
 * (Agencies). Тексты и цель действия берутся отсюда, а не выводятся заново
 * в каждом месте разметки — иначе один пропущенный случай тихо забанил бы
 * не то, что показывает кнопка.
 */
const BLOCK_LABELS = {
  account: {
    block: 'blockUser',
    unblock: 'unblockUser',
    reason: 'blockReason',
    hint: 'blockReasonHint',
    blockedBadge: 'userBlocked',
  },
  profile: {
    block: 'blockProfile',
    unblock: 'unblockProfile',
    reason: 'blockProfileReason',
    hint: 'blockProfileHint',
    blockedBadge: 'profileBlocked',
  },
  agency: {
    block: 'blockAgency',
    unblock: 'unblockAgency',
    reason: 'blockAgencyReason',
    hint: 'blockAgencyHint',
    blockedBadge: 'agencyBlocked',
  },
} as const;

function blockModeFor(advertiserKind?: AdvertiserKind): keyof typeof BLOCK_LABELS {
  if (advertiserKind === 'individual' || advertiserKind === 'salon') return 'profile';
  if (advertiserKind === 'agency') return 'agency';
  return 'account';
}

/** Имя в строке: у индивидуалки и салона — имя анкеты, у агентства — название
 *  компании, у клиента — ник. `null`, если имени нет. */
function rowName(user: ManagedUser): string | null {
  if (user.advertiserKind === 'individual' || user.advertiserKind === 'salon') {
    return user.profile?.displayName ?? null;
  }
  if (user.advertiserKind === 'agency') return user.company?.name ?? null;
  return user.nickname;
}

/** Цель «Дать ТОП» по строке — анкета или компания, независимо от вкладки:
 *  действие смотрит на тип самого рекламодателя в строке, а не на фильтр
 *  списка (нужно и на «Все пользователи»). */
function topTargetFor(
  user: ManagedUser,
): { kind: 'profile' | 'company'; id: string; isFeatured: boolean } | null {
  if (user.advertiserKind === 'individual' || user.advertiserKind === 'salon') {
    return user.profile
      ? { kind: 'profile', id: user.profile.id, isFeatured: user.profile.isFeatured }
      : null;
  }
  if (user.advertiserKind === 'agency') {
    return user.company
      ? { kind: 'company', id: user.company.id, isFeatured: user.company.isFeatured }
      : null;
  }
  return null;
}

export function UserList({
  blockedOnly = false,
  withRoleFilter = false,
  advertiserKind,
}: {
  blockedOnly?: boolean;
  withRoleFilter?: boolean;
  /** Раздел People по типу рекламодателя — Agencies/Individuals/Massage
   *  salons. Не задан на «Все пользователи»: там блокировка — аккаунт. */
  advertiserKind?: AdvertiserKind;
} = {}) {
  const t = useTranslations('moderation');
  const { user: me } = useSession();
  /**
   * Баланс правят и админ, и модератор — но с разными правами: у модератора
   * сумма ограничена потолком из настроек монетизации. Потолок приходит с
   * сервера отдельным запросом, а не выводится из роли: он настраивается, и
   * зашитое в кабинете число разошлось бы с проверкой на сервере молча.
   */
  const isStaffActor = me?.role === 'admin' || me?.role === 'moderator';
  const isAdmin = me?.role === 'admin';
  const blockMode = blockModeFor(advertiserKind);
  const labels = BLOCK_LABELS[blockMode];
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

  const adjustLimit = useQuery({
    queryKey: queryKeys.adjustLimit(),
    queryFn: fetchAdjustLimit,
    enabled: isStaffActor,
    // Потолок меняется правкой настроек, то есть почти никогда.
    staleTime: 5 * 60 * 1000,
  });
  const limitGc = adjustLimit.data?.limitGc ?? null;

  // Кого удаляем: подтверждение раскрывается у строки, а не в модальном окне —
  // так же, как причина блокировки.
  const [deleting, setDeleting] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: queryKeys.users(debounced, blockedOnly, role || undefined, advertiserKind),
    queryFn: ({ pageParam }) =>
      fetchUsers(debounced || undefined, blockedOnly, role || undefined, pageParam, advertiserKind),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  // Блокировка меняет и общий список, и таблицу заблокированных — гасим
  // всю группу, а не текущий ключ. Счётчик очереди — ради числа на вкладке
  // «Заблокированные пользователи»: без этого оно отставало бы от списка.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['moderation-users'], exact: false }),
      queryClient.invalidateQueries({ queryKey: queryKeys.queueCount() }),
    ]);

  const verify = useMutation({
    mutationFn: (user: ManagedUser) => verifyUserEmail(user.id),
    onSuccess: invalidate,
  });

  const block = useMutation({
    mutationFn: async (user: ManagedUser): Promise<void> => {
      if (blockMode === 'profile') {
        await blockProfile(user.profile?.id ?? '', reason.trim());
        return;
      }
      if (blockMode === 'agency') {
        await blockCompany(user.company?.id ?? '', reason.trim());
        return;
      }
      await blockUser(user.id, reason.trim());
    },
    onSuccess: async () => {
      setBlocking(null);
      setReason('');
      await invalidate();
    },
  });

  const unblock = useMutation({
    mutationFn: async (user: ManagedUser): Promise<void> => {
      if (blockMode === 'profile') {
        await unblockProfile(user.profile?.id ?? '');
        return;
      }
      if (blockMode === 'agency') {
        await unblockCompany(user.company?.id ?? '');
        return;
      }
      await unblockUser(user.id);
    },
    onSuccess: invalidate,
  });

  const grantTop = useMutation({
    mutationFn: async (user: ManagedUser): Promise<void> => {
      const target = topTargetFor(user);
      if (!target) throw new Error('no top target');
      if (target.kind === 'profile') await grantProfileTop(target.id);
      else await grantCompanyTop(target.id);
    },
    onSuccess: invalidate,
  });

  const adjustInput = (user: ManagedUser) =>
    adjustBalanceInputSchema.safeParse({
      userId: user.id,
      gcAmount: Number(amount),
      note: note.trim(),
    });

  /** Готова ли форма к отправке. Потолок здесь тот же, что проверяет сервер:
   *  доступная кнопка, отвечающая отказом, — худший вид подсказки. */
  const canSubmitAdjust = (user: ManagedUser) =>
    adjustInput(user).success && isAdjustWithinLimit(Number(amount), limitGc);

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
    remove.isPending ||
    grantTop.isPending;
  const adjustStatus = adjust.error instanceof BillingError ? adjust.error.status : null;
  const error =
    adjustStatus === 409
      ? 'adjustInsufficient'
      : // 403 на этом маршруте означает не «нет прав вовсе», а «сумма выше
        // потолка»: сам маршрут модератору открыт.
        adjustStatus === 403
        ? 'adjustOverLimit'
        : verify.isError ||
            block.isError ||
            unblock.isError ||
            adjust.isError ||
            remove.isError ||
            grantTop.isError
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
            const entityBlocked =
              blockMode === 'profile'
                ? user.profile?.status === 'banned'
                : blockMode === 'agency'
                  ? (user.company?.isBanned ?? false)
                  : user.isBlocked;
            const canBlockRow =
              blockMode === 'profile'
                ? user.profile !== null
                : blockMode === 'agency'
                  ? user.company !== null
                  : true;
            // Ссылка строки смотрит на тип самого рекламодателя в строке, а не
            // на фильтр вкладки (нужно и на «Все пользователи»): иначе клик по
            // агентству из общего списка вёл бы на голую карточку аккаунта
            // вместо объединённой карточки агентства с тарифом и анкетами.
            const rowHref =
              (user.advertiserKind === 'individual' || user.advertiserKind === 'salon') &&
              user.profile
                ? `/moderation/profiles/${user.profile.id}`
                : user.advertiserKind === 'agency' && user.company
                  ? `/admin/companies/${user.company.id}`
                  : `/moderation/users/${user.id}`;
            const topTarget = topTargetFor(user);
            // Быстрые действия остались только на «Все пользователи»: там
            // страница строки — просмотр без действий (см. `UserDetail`).
            // На Agencies/Individuals/Massage salons действия — только на
            // карточке самой сущности (ProfileReview/AgencyTariffDetail),
            // сюда попадают по ссылке ниже.
            const isSpecializedView = advertiserKind !== undefined;
            return (
              <div className={styles.staffRow} key={user.id}>
                <div className={styles.staffMain}>
                  {/* Почта — ссылка: страница отвечает на «что у него»,
                      список отвечает на «кто это». Для Agencies/Individuals/
                      Massage salons ведёт прямо на карточку сущности вкладки —
                      там те же действия, что и здесь. */}
                  <Link className={styles.staffEmail} href={rowHref}>
                    {rowName(user) ? (
                      <>
                        {rowName(user)}
                        <span className={styles.staffEmailDim}> | {user.email}</span>
                      </>
                    ) : (
                      user.email
                    )}
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
                  {blockMode === 'agency' && user.company?.banReason ? (
                    <span className={styles.reportBody}>{user.company.banReason}</span>
                  ) : null}
                  {blockMode !== 'account' && !canBlockRow ? (
                    <span className={styles.hint}>
                      {t(blockMode === 'profile' ? 'userNoProfiles' : 'agencyNotSetUp')}
                    </span>
                  ) : null}

                  {!isSpecializedView && adjusted?.userId === user.id ? (
                    <span className={styles.hint}>
                      {t('adjustDone', { balance: adjusted.balanceGc })}
                    </span>
                  ) : null}

                  {!isSpecializedView && adjusting === user.id ? (
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
                      <span className={styles.hint}>
                        {t('adjustAmountHint')}
                        {limitGc === null ? null : ` ${t('adjustLimitHint', { limit: limitGc })}`}
                      </span>
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
                          disabled={busy || !canSubmitAdjust(user)}
                          onClick={() => adjust.mutate(user)}
                        >
                          <GlowCoinIcon size={16} />
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

                  {!isSpecializedView && deleting === user.id ? (
                    <div className={styles.reasonBox}>
                      <span className={styles.hint}>{t('deleteUserHint')}</span>
                      <div className={styles.cardActions} style={{ padding: 0 }}>
                        <Button disabled={busy} onClick={() => remove.mutate(user)}>
                          <DeleteIcon />
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

                  {!isSpecializedView && blocking === user.id ? (
                    <div className={styles.reasonBox}>
                      <textarea
                        className={styles.textarea}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={t(labels.reason)}
                        minLength={5}
                      />
                      <span className={styles.hint}>{t(labels.hint)}</span>
                      <div className={styles.cardActions} style={{ padding: 0 }}>
                        <Button
                          disabled={busy || reason.trim().length < 5}
                          onClick={() => block.mutate(user)}
                        >
                          <BlockIcon />
                          {t(labels.block)}
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

                {/* Agencies/Individuals/Massage salons: только статус, без
                    кнопок — действия только на карточке самой сущности. */}
                <div className={styles.cardActions} style={{ padding: 0 }}>
                  {entityBlocked ? (
                    <span className={`${styles.badge} ${styles.badgeBlocked}`}>
                      {t(labels.blockedBadge)}
                    </span>
                  ) : null}
                  {!isSpecializedView && entityBlocked ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => unblock.mutate(user)}
                    >
                      <UnblockIcon />
                      {t(labels.unblock)}
                    </Button>
                  ) : null}

                  {!user.isEmailVerified ? (
                    <span className={`${styles.badge} ${styles.badgeBlocked}`}>
                      {t('emailNotVerified')}
                    </span>
                  ) : (
                    <span className={styles.badge}>{t('emailVerified')}</span>
                  )}
                  {!isSpecializedView && !user.isEmailVerified ? (
                    <Button variant="secondary" disabled={busy} onClick={() => verify.mutate(user)}>
                      <VerifyIcon />
                      {t('verifyEmail')}
                    </Button>
                  ) : null}

                  {isAdmin && user.role === 'advertiser' ? (
                    <AdvertiserAnalyticsLink userId={user.id} />
                  ) : null}

                  {topTarget?.isFeatured ? (
                    <span className={styles.badge}>{t('userInTop')}</span>
                  ) : null}

                  {isSpecializedView ? null : (
                    <>
                      {isStaffActor && user.role === 'advertiser' && adjusting !== user.id ? (
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
                          <GlowCoinIcon size={16} />
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
                          <DeleteIcon />
                          {t('deleteUser')}
                        </Button>
                      ) : null}

                      {/* Сотрудниками распоряжается админ через /admin/staff:
                          коллеги — не предмет модерации. */}
                      {!entityBlocked && !isStaff && canBlockRow && blocking !== user.id ? (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            setBlocking(user.id);
                            setReason('');
                          }}
                        >
                          <BlockIcon />
                          {t(labels.block)}
                        </Button>
                      ) : null}

                      {/* Выдача ТОПа без оплаты — обход платежа, только
                          админ, как и прочие денежные решения
                          (payments.md §3.4/D-10). */}
                      {isAdmin && topTarget && !topTarget.isFeatured ? (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => grantTop.mutate(user)}
                        >
                          <TopIcon />
                          {t('grantTop')}
                        </Button>
                      ) : null}
                    </>
                  )}
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
