'use client';

import { adjustBalanceInputSchema, isAdjustWithinLimit } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { grantCompanyTop } from '@/modules/agencies/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { adjustBalance, BillingError, fetchAdjustLimit } from '@/modules/billing/api';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import {
  blockUser,
  deleteUser,
  fetchUserDetail,
  grantProfileTop,
  unblockUser,
  verifyUserEmail,
} from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { ActionCard } from '../ActionCard';
import cardStyles from '../ActionCard/ActionCard.module.css';
import { BlockIcon, DeleteIcon, TopIcon, UnblockIcon, VerifyIcon } from '../icons';
import styles from '../Moderation.module.css';
import { ProfileSummaryList } from '../ProfileSummaryList';

const ADVERTISER_LABEL = {
  individual: 'advertiserIndividual',
  salon: 'advertiserSalon',
  agency: 'advertiserAgency',
} as const;

/** Цель «Дать ТОП» — анкета индивидуалки/салона или компания агентства.
 *  `null`, если рекламодатель ещё не завёл ни то ни другое: сюда и попадают
 *  чаще всего — иначе строка списка вела бы прямо на карточку сущности. */
type TopTarget = {
  kind: 'profile' | 'company';
  id: string;
  isFeatured: boolean;
  topExpiresAt: string | null;
  notPublished: boolean;
} | null;

/**
 * Пользователь целиком: тип размещения, подписка, баланс, анкеты.
 *
 * Действия здесь — не по анкете/компании (для этого есть их собственные
 * карточки, ProfileReview/AgencyTariffDetail), а по самому аккаунту: сюда
 * попадают и со списка «Все пользователи», и с Agencies/Individuals/Massage
 * salons, если рекламодатель ещё не завёл анкету или компанию — тогда
 * действовать больше не на чем, и это единственная страница, где вообще
 * можно что-то сделать.
 */
export function UserDetail({ userId }: { userId: string }) {
  const t = useTranslations('moderation');
  // Подписи типов размещения — те же, что при регистрации и в кабинете.
  const ta = useTranslations('auth');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [adjustedBalance, setAdjustedBalance] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const adjustLimit = useQuery({
    queryKey: queryKeys.adjustLimit(),
    queryFn: fetchAdjustLimit,
    enabled: isStaff,
    staleTime: 5 * 60 * 1000,
  });
  const limitGc = adjustLimit.data?.limitGc ?? null;

  const detail = useQuery({
    queryKey: queryKeys.managedUser(userId),
    queryFn: () => fetchUserDetail(userId),
    enabled: status === 'authenticated' && isStaff,
  });

  // Гасим и карточку пользователя, и список — иначе, вернувшись в
  // Agencies/Individuals/Massage salons или «Все пользователи», увидели бы
  // прежний статус до следующего запроса.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.managedUser(userId) }),
      queryClient.invalidateQueries({ queryKey: ['moderation-users'], exact: false }),
      queryClient.invalidateQueries({ queryKey: queryKeys.queueCount() }),
    ]);

  const verify = useMutation({
    mutationFn: () => verifyUserEmail(userId),
    onSuccess: refresh,
  });

  const block = useMutation({
    mutationFn: () => blockUser(userId, reason.trim()),
    onSuccess: async () => {
      setBlocking(false);
      setReason('');
      await refresh();
    },
  });

  const unblock = useMutation({
    mutationFn: () => unblockUser(userId),
    onSuccess: refresh,
  });

  const grantTop = useMutation({
    mutationFn: async (target: TopTarget): Promise<void> => {
      if (!target) throw new Error('no top target');
      if (target.kind === 'profile') await grantProfileTop(target.id);
      else await grantCompanyTop(target.id);
    },
    onSuccess: refresh,
  });

  const adjustInput = () =>
    adjustBalanceInputSchema.safeParse({
      userId,
      gcAmount: Number(amount),
      note: note.trim(),
    });

  const canSubmitAdjust = () =>
    adjustInput().success && isAdjustWithinLimit(Number(amount), limitGc);

  const adjust = useMutation({
    mutationFn: () => {
      const parsed = adjustInput();
      if (!parsed.success) throw new Error('invalid');
      return adjustBalance(parsed.data);
    },
    onSuccess: async (result) => {
      setAdjusting(false);
      setAmount('');
      setNote('');
      setAdjustedBalance(result.balanceGc);
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteUser(userId),
    onSuccess: () => router.replace('/moderation/users'),
  });

  const adjustStatus = adjust.error instanceof BillingError ? adjust.error.status : null;
  const busy =
    verify.isPending ||
    block.isPending ||
    unblock.isPending ||
    grantTop.isPending ||
    adjust.isPending ||
    remove.isPending;

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isStaff) return <p className={styles.empty}>{t('onlyStaff')}</p>;
  if (detail.isError) return <p className={styles.empty}>{t('loadFailed')}</p>;
  if (!detail.data) return <p className={styles.empty}>{t('loading')}</p>;

  const data = detail.data;
  const isTargetStaff = data.role === 'moderator' || data.role === 'admin';
  const topTarget: TopTarget =
    data.advertiserKind === 'individual' || data.advertiserKind === 'salon'
      ? data.profile
        ? {
            kind: 'profile',
            id: data.profile.id,
            isFeatured: data.profile.isFeatured,
            topExpiresAt: data.profile.topExpiresAt,
            notPublished: data.profile.status !== 'published',
          }
        : null
      : data.advertiserKind === 'agency'
        ? data.company
          ? {
              kind: 'company',
              id: data.company.id,
              isFeatured: data.company.isFeatured,
              topExpiresAt: data.company.topExpiresAt,
              notPublished: false,
            }
          : null
        : null;
  // Уже в ТОПе — не запрет: кнопка продлевает место.
  const topDisabledReason = !topTarget
    ? t('topDisabledNotPublished')
    : topTarget.notPublished
      ? t('topDisabledNotPublished')
      : undefined;

  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const rows: { label: string; value: string }[] = [
    { label: t('userRole'), value: t(`role_${data.role}`) },
    ...(data.advertiserKind
      ? [{ label: t('userKind'), value: ta(ADVERTISER_LABEL[data.advertiserKind]) }]
      : []),
    {
      label: t('userSubscription'),
      // Срока может не быть: размещение, выданное акцией, не покупалось.
      // Без этой ветки ключ собирался бы как `term_null` и ронял страницу.
      value: data.subscription
        ? [
            t(`subscriptionStatus_${data.subscription.status}`),
            data.subscription.term ? t(`term_${data.subscription.term}`) : t('termFromCampaign'),
            `${t('userUntil')} ${when(data.subscription.expiresAt)}`,
          ].join(' · ')
        : t('userNoSubscription'),
    },
    ...(data.role === 'advertiser'
      ? [{ label: t('userBalance'), value: t('balanceGc', { balance: data.glowcoinBalance }) }]
      : []),
    {
      label: t('userEmailState'),
      value: t(data.isEmailVerified ? 'emailVerified' : 'emailNotVerified'),
    },
    { label: t('userRegistered'), value: when(data.createdAt) },
    { label: t('userLastLogin'), value: when(data.lastLoginAt) },
    { label: t('userLocale'), value: data.locale.toUpperCase() },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{data.email}</h1>
        <Link className={styles.link} href="/moderation/users">
          {t('backToUsers')}
        </Link>
      </div>

      {data.deletionRequestedAt ? (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>
          {t('userDeletionRequested', { date: when(data.deletionRequestedAt) })}
        </p>
      ) : null}

      {!isTargetStaff ? (
        <div className={cardStyles.grid}>
          {/* Блокировка — учётная запись целиком: страницы конкретной
              анкеты/компании ещё нет (иначе сюда бы и не попали), банить
              больше нечего. */}
          <ActionCard
            icon={data.isBlocked ? <UnblockIcon /> : <BlockIcon />}
            title={t('blockUser')}
            status={data.isBlocked ? t('userBlocked') : undefined}
            tone={data.isBlocked ? 'danger' : 'default'}
            expanded={blocking}
          >
            {data.isBlocked ? (
              <>
                {data.banReason ? <span className={styles.hint}>{data.banReason}</span> : null}
                <div className={cardStyles.actions}>
                  <Button variant="secondary" disabled={busy} onClick={() => unblock.mutate()}>
                    <UnblockIcon />
                    {t('unblockUser')}
                  </Button>
                </div>
              </>
            ) : blocking ? (
              <>
                <textarea
                  className={styles.textarea}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t('blockReason')}
                  minLength={5}
                />
                <span className={styles.hint}>{t('blockReasonHint')}</span>
                <div className={cardStyles.actions}>
                  <Button
                    disabled={busy || reason.trim().length < 5}
                    onClick={() => block.mutate()}
                  >
                    <BlockIcon />
                    {t('blockUser')}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setBlocking(false)}>
                    {t('cancel')}
                  </Button>
                </div>
              </>
            ) : (
              <div className={cardStyles.actions}>
                <Button variant="secondary" disabled={busy} onClick={() => setBlocking(true)}>
                  <BlockIcon />
                  {t('blockUser')}
                </Button>
              </div>
            )}
          </ActionCard>

          {/* Подтверждение почты вручную — обходит письмо, сотрудник
              ручается за адрес вместо него. Кнопка видна всегда, дизейблена
              после подтверждения — так же, как остальные действия. */}
          <ActionCard
            icon={<VerifyIcon />}
            title={t('verifyEmail')}
            status={t(data.isEmailVerified ? 'emailVerified' : 'emailNotVerified')}
          >
            <div className={cardStyles.actions}>
              <Button
                variant="secondary"
                disabled={busy || data.isEmailVerified}
                onClick={() => verify.mutate()}
              >
                <VerifyIcon />
                {t('verifyEmail')}
              </Button>
            </div>
          </ActionCard>

          {/* Выдача ТОПа без оплаты — только админ. Обычно недоступна именно
              здесь: сюда попадают, когда анкеты или компании ещё нет, а
              значит и метить в ТОП нечего — кнопка это и объясняет тултипом,
              а не пропадает молча. */}
          {isAdmin && data.advertiserKind ? (
            <ActionCard
              icon={<TopIcon />}
              title={t('topSection')}
              status={
                topTarget?.isFeatured && topTarget.topExpiresAt
                  ? t('topActiveUntil', {
                      date: new Date(topTarget.topExpiresAt).toLocaleDateString(),
                    })
                  : t('topInactive')
              }
            >
              <div className={cardStyles.actions}>
                <Button
                  variant="secondary"
                  disabled={busy || Boolean(topDisabledReason)}
                  title={topDisabledReason}
                  onClick={() => grantTop.mutate(topTarget)}
                >
                  <TopIcon />
                  {t(topTarget?.isFeatured ? 'extendTop' : 'grantTop')}
                </Button>
              </div>
              {grantTop.isError ? <span className={styles.hint}>{t('topGrantFailed')}</span> : null}
            </ActionCard>
          ) : null}

          {/* Монеты — staff, потолок для модератора проверяется и на сервере. */}
          {data.role === 'advertiser' ? (
            <ActionCard
              icon={<GlowCoinIcon size={18} />}
              title={t('adjustGc')}
              status={t('balanceGc', { balance: data.glowcoinBalance })}
              expanded={adjusting}
            >
              {adjusting ? (
                <>
                  <div className={cardStyles.field}>
                    <label className={styles.label} htmlFor="adjust-amount">
                      {t('adjustAmount')}
                    </label>
                    <input
                      className={styles.input}
                      id="adjust-amount"
                      inputMode="numeric"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="+100"
                    />
                    <span className={styles.hint}>
                      {t('adjustAmountHint')}
                      {limitGc === null ? null : ` ${t('adjustLimitHint', { limit: limitGc })}`}
                    </span>
                  </div>
                  <div className={cardStyles.field}>
                    <label className={styles.label} htmlFor="adjust-note">
                      {t('adjustNote')}
                    </label>
                    <textarea
                      className={styles.textarea}
                      id="adjust-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      minLength={3}
                    />
                    <span className={styles.hint}>{t('adjustNoteHint')}</span>
                  </div>
                  {adjustStatus === 409 ? (
                    <span className={styles.hint}>{t('adjustInsufficient')}</span>
                  ) : adjustStatus === 403 ? (
                    <span className={styles.hint}>{t('adjustOverLimit')}</span>
                  ) : null}
                  <div className={cardStyles.actions}>
                    <Button disabled={busy || !canSubmitAdjust()} onClick={() => adjust.mutate()}>
                      <GlowCoinIcon size={16} />
                      {t('adjustSubmit')}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setAdjusting(false)}>
                      {t('cancel')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className={cardStyles.actions}>
                  <Button variant="secondary" disabled={busy} onClick={() => setAdjusting(true)}>
                    <GlowCoinIcon size={16} />
                    {t('adjustGc')}
                  </Button>
                  {adjustedBalance !== null ? (
                    <span className={styles.hint}>
                      {t('adjustDone', { balance: adjustedBalance })}
                    </span>
                  ) : null}
                </div>
              )}
            </ActionCard>
          ) : null}

          {/* Удалить учётку — необратимо, только админ. */}
          {isAdmin ? (
            <ActionCard
              icon={<DeleteIcon />}
              title={t('deleteUser')}
              tone="danger"
              expanded={deleting}
            >
              {deleting ? (
                <>
                  <span className={styles.hint}>{t('deleteUserHint')}</span>
                  <div className={cardStyles.actions}>
                    <Button disabled={busy} onClick={() => remove.mutate()}>
                      <DeleteIcon />
                      {t('deleteUserConfirm')}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setDeleting(false)}>
                      {t('cancel')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className={cardStyles.actions}>
                  <Button variant="secondary" disabled={busy} onClick={() => setDeleting(true)}>
                    <DeleteIcon />
                    {t('deleteUser')}
                  </Button>
                </div>
              )}
            </ActionCard>
          ) : null}
        </div>
      ) : null}

      <dl className={styles.userRows}>
        {rows.map((row) => (
          <div className={styles.userRow} key={row.label}>
            <dt className={styles.userLabel}>{row.label}</dt>
            <dd className={styles.userValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <ProfileSummaryList
        profiles={data.profiles}
        title={t('userProfilesTitle', { count: data.profiles.length })}
        emptyText={t('userNoProfiles')}
        statusLabel={(profileStatus) => t(`profileStatus_${profileStatus}`)}
        verifiedLabel={t('identityBadge')}
        featuredLabel={t('userInTop')}
        openLabel={t('openProfile')}
      />
    </div>
  );
}
