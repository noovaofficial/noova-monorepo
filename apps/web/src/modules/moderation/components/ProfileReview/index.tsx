'use client';

import { adjustBalanceInputSchema, isAdjustWithinLimit } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { adjustBalance, BillingError, fetchAdjustLimit } from '@/modules/billing/api';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import {
  approvePhoto,
  blockProfile,
  deleteModeratedProfile,
  deleteUser,
  fetchModeratedProfile,
  grantProfileTop,
  rejectPhoto,
  unblockProfile,
} from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { ActionCard } from '../ActionCard';
import cardStyles from '../ActionCard/ActionCard.module.css';
import { AdvertiserAnalyticsLink } from '../AdvertiserAnalytics';
import { BlockIcon, DeleteIcon, TopIcon, UnblockIcon } from '../icons';
import styles from '../Moderation.module.css';
import { PhotoViewer } from '../PhotoViewer';

const euro = (cents: number | null) => (cents === null ? '—' : `${Math.round(cents / 100)} €`);

export function ProfileReview({ profileId }: { profileId: string }) {
  const t = useTranslations('moderation');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  const queryClient = useQueryClient();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [adjustedBalance, setAdjustedBalance] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [topDays, setTopDays] = useState('');
  const [rejectingPhotoId, setRejectingPhotoId] = useState<string | null>(null);
  const [photoReason, setPhotoReason] = useState('');

  const adjustLimit = useQuery({
    queryKey: queryKeys.adjustLimit(),
    queryFn: fetchAdjustLimit,
    enabled: isStaff,
    staleTime: 5 * 60 * 1000,
  });
  const limitGc = adjustLimit.data?.limitGc ?? null;

  const review = useQuery({
    queryKey: queryKeys.moderatedProfile(profileId),
    queryFn: () => fetchModeratedProfile(profileId),
    enabled: status === 'authenticated' && isStaff,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.moderatedProfile(profileId) });
    // Блокировка закрывает жалобы на анкету и меняет счётчик в шапке.
    await queryClient.invalidateQueries({ queryKey: ['moderation-queue'], exact: false });
    await queryClient.invalidateQueries({ queryKey: queryKeys.queueCount() });
  };

  const block = useMutation({
    mutationFn: () => blockProfile(profileId, reason.trim()),
    onSuccess: async () => {
      setBlocking(false);
      setReason('');
      await refresh();
    },
  });

  const unblock = useMutation({
    mutationFn: () => unblockProfile(profileId),
    onSuccess: refresh,
  });

  const grantTop = useMutation({
    mutationFn: (days?: number) => grantProfileTop(profileId, days),
    onSuccess: refresh,
  });

  const approvePhotoM = useMutation({
    mutationFn: (photoId: string) => approvePhoto(photoId),
    onSuccess: refresh,
  });

  const rejectPhotoM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectPhoto(id, reason),
    onSuccess: async () => {
      setRejectingPhotoId(null);
      setPhotoReason('');
      await refresh();
    },
  });

  const adjustInput = (ownerId: string) =>
    adjustBalanceInputSchema.safeParse({
      userId: ownerId,
      gcAmount: Number(amount),
      note: note.trim(),
    });

  const canSubmitAdjust = (ownerId: string) =>
    adjustInput(ownerId).success && isAdjustWithinLimit(Number(amount), limitGc);

  const adjust = useMutation({
    mutationFn: (ownerId: string) => {
      const parsed = adjustInput(ownerId);
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
    mutationFn: (ownerId: string) => deleteUser(ownerId),
    onSuccess: () => router.replace('/moderation/users/individuals'),
  });

  const removeProfile = useMutation({
    mutationFn: () => deleteModeratedProfile(profileId),
    onSuccess: () => router.replace('/moderation'),
  });

  const profile = review.data ?? null;
  const error = review.isError ? 'notFound' : null;
  const adjustStatus = adjust.error instanceof BillingError ? adjust.error.status : null;
  const busy =
    block.isPending ||
    unblock.isPending ||
    grantTop.isPending ||
    adjust.isPending ||
    remove.isPending ||
    removeProfile.isPending ||
    approvePhotoM.isPending ||
    rejectPhotoM.isPending;

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isStaff) return <p className={styles.empty}>{t('onlyStaff')}</p>;
  if (error) return <p className={styles.empty}>{t(error)}</p>;
  if (!profile) return <p className={styles.empty}>{t('loading')}</p>;

  const params: [string, string][] = [
    [t('status'), profile.status],
    [t('owner'), profile.owner.email],
    ['', `${profile.cityName}${profile.districtName ? ` · ${profile.districtName}` : ''}`],
    ...(profile.age ? ([['age', String(profile.age)]] as [string, string][]) : []),
    ...(profile.heightCm ? ([['cm', String(profile.heightCm)]] as [string, string][]) : []),
    ...(profile.languages.length
      ? ([['lang', profile.languages.join(', ')]] as [string, string][])
      : []),
  ];

  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  // Детали аккаунта владелицы — те же, что на карточке пользователя
  // (`UserDetail`): объединённая карточка анкеты не должна отправлять за
  // ролью/почтой/датами на отдельную страницу.
  const accountRows: { label: string; value: string }[] = [
    { label: t('userRole'), value: t(`role_${profile.owner.role}`) },
    { label: t('userBalance'), value: t('balanceGc', { balance: profile.owner.glowcoinBalance }) },
    {
      label: t('userEmailState'),
      value: t(profile.owner.isEmailVerified ? 'emailVerified' : 'emailNotVerified'),
    },
    { label: t('userRegistered'), value: when(profile.owner.createdAt) },
    { label: t('userLastLogin'), value: when(profile.owner.lastLoginAt) },
    { label: t('userLocale'), value: profile.owner.locale.toUpperCase() },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>
          {t('profileTitle')}: {profile.displayName}
        </h1>
        <div className={styles.headActions}>
          {isAdmin ? <AdvertiserAnalyticsLink userId={profile.owner.id} /> : null}
          <Link className={styles.link} href="/moderation">
            ← {t('back')}
          </Link>
        </div>
      </div>

      <div className={cardStyles.grid}>
        {/* Блокировка анкеты — основная мера модератора: показ прекращается,
            но владелица видит причину, правит и отправляет на проверку заново.
            Учётная запись при этом не трогается, иначе исправить было бы нечем. */}
        <ActionCard
          icon={profile.status === 'banned' ? <UnblockIcon /> : <BlockIcon />}
          title={t('blockProfile')}
          status={profile.status === 'banned' ? t('profileBlocked') : undefined}
          tone={profile.status === 'banned' ? 'danger' : 'default'}
          expanded={blocking}
        >
          {profile.status === 'banned' ? (
            <div className={cardStyles.actions}>
              <Button variant="secondary" disabled={busy} onClick={() => unblock.mutate()}>
                <UnblockIcon />
                {t('unblockProfile')}
              </Button>
            </div>
          ) : blocking ? (
            <>
              <textarea
                className={styles.textarea}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('blockProfileReason')}
                minLength={5}
              />
              <span className={styles.hint}>{t('blockProfileHint')}</span>
              <div className={cardStyles.actions}>
                <Button disabled={busy || reason.trim().length < 5} onClick={() => block.mutate()}>
                  <BlockIcon />
                  {t('blockProfile')}
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
                {t('blockProfile')}
              </Button>
            </div>
          )}
        </ActionCard>

        {/* Выдача ТОПа без оплаты (payments.md §3.4/D-10) — обход платежа,
            только админ, как и прочие денежные решения. Кнопка видна всегда:
            когда выдать нельзя, она задизейблена, а причина — в подсказке
            при наведении, а не молчаливо скрытая кнопка. */}
        {isAdmin ? (
          <ActionCard
            icon={<TopIcon />}
            title={t('topSection')}
            status={
              profile.isFeatured && profile.topExpiresAt
                ? t('topActiveUntil', { date: new Date(profile.topExpiresAt).toLocaleDateString() })
                : t('topInactive')
            }
          >
            <div className={cardStyles.field}>
              <label className={styles.label} htmlFor="top-days">
                {t('topDurationLabel')}
              </label>
              <input
                className={styles.input}
                id="top-days"
                inputMode="numeric"
                value={topDays}
                onChange={(event) => setTopDays(event.target.value)}
                placeholder="7"
              />
            </div>
            <div className={cardStyles.actions}>
              <Button
                variant="secondary"
                disabled={
                  busy ||
                  profile.status !== 'published' ||
                  (topDays.trim() !== '' && (!/^\d+$/.test(topDays.trim()) || Number(topDays) < 1))
                }
                title={profile.status !== 'published' ? t('topDisabledNotPublished') : undefined}
                onClick={() =>
                  grantTop.mutate(topDays.trim() === '' ? undefined : Number(topDays.trim()))
                }
              >
                <TopIcon />
                {t(profile.isFeatured ? 'extendTop' : 'grantTop')}
              </Button>
            </div>
            {grantTop.isError ? <span className={styles.hint}>{t('topGrantFailed')}</span> : null}
          </ActionCard>
        ) : null}

        {/* Монеты — staff, потолок для модератора проверяется и на сервере.
            Анкете агентства коины не выдаём: баланс общий на всю учётку
            агентства, а не привязан к конкретной анкете — здесь легко
            перепутать «пополнить анкету» с «пополнить агентство целиком». */}
        {isStaff && profile.companyId === null ? (
          <ActionCard
            icon={<GlowCoinIcon size={18} />}
            title={t('adjustGc')}
            status={t('balanceGc', { balance: profile.owner.glowcoinBalance })}
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
                  <Button
                    disabled={busy || !canSubmitAdjust(profile.owner.id)}
                    onClick={() => adjust.mutate(profile.owner.id)}
                  >
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

        {/* Удалить учётку — только для индивидуалки/салона: их анкета и
            аккаунт — одно и то же. Для анкеты агентства (companyId задан)
            удаление аккаунта снесло бы весь его каталог разом, а с появлением
            отдельного удаления анкеты (карточка ниже) держать здесь ещё и
            задизейбленную кнопку — только путать: это действие теперь только
            с карточки самого агентства, где видно, что удаляется целиком. */}
        {isAdmin && profile.companyId === null ? (
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
                  <Button disabled={busy} onClick={() => remove.mutate(profile.owner.id)}>
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

        {/* Удалить анкету — в отличие от удаления учётки выше, работает и
            для анкеты агентства: агентский каталог состоит из многих анкет
            на одной учётке, и убрать одну, не трогая остальные, — обычное
            дело, которого раньше не было (только целиком аккаунт). */}
        {isStaff ? (
          <ActionCard
            icon={<DeleteIcon />}
            title={t('deleteProfile')}
            tone="danger"
            expanded={deletingProfile}
          >
            {deletingProfile ? (
              <>
                <span className={styles.hint}>{t('deleteProfileHint')}</span>
                <div className={cardStyles.actions}>
                  <Button disabled={busy} onClick={() => removeProfile.mutate()}>
                    <DeleteIcon />
                    {t('deleteProfileConfirm')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setDeletingProfile(false)}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </>
            ) : (
              <div className={cardStyles.actions}>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDeletingProfile(true)}
                >
                  <DeleteIcon />
                  {t('deleteProfile')}
                </Button>
              </div>
            )}
          </ActionCard>
        ) : null}
      </div>

      <dl className={styles.userRows}>
        {accountRows.map((row) => (
          <div className={styles.userRow} key={row.label}>
            <dt className={styles.userLabel}>{row.label}</dt>
            <dd className={styles.userValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {viewing !== null ? (
        <PhotoViewer
          photos={profile.photos.map((photo) => ({ url: photo.fullUrl }))}
          index={viewing}
          onClose={() => setViewing(null)}
          onStep={(delta) =>
            setViewing((current) =>
              current === null
                ? null
                : (current + delta + profile.photos.length) % profile.photos.length,
            )
          }
        />
      ) : null}

      {profile.photos.length > 0 ? (
        <div className={styles.list} style={{ marginBottom: 'var(--space5)' }}>
          {profile.photos.map((photo, index) => (
            <div className={styles.card} key={photo.id}>
              <div className={styles.cardPhoto}>
                {/* Открывается во весь экран, и оттуда листается стрелками:
                    в ряду карточек детали фотографии не разглядеть. */}
                <button
                  type="button"
                  className={styles.openPhoto}
                  onClick={() => setViewing(index)}
                  aria-label={t('photoOpen')}
                >
                  {/* Ссылка на неодобренное фото подписанная и живёт минуты —
                      оптимизатор Next закэшировал бы её и отдавал битую. */}
                  {/* biome-ignore lint/performance/noImgElement: подписанная ссылка живёт минуты, оптимизатор Next закэшировал бы её и отдавал битую */}
                  <img src={photo.url} alt="" loading="lazy" />
                </button>
                {!photo.isApproved ? (
                  <span
                    className={`${styles.badge} ${styles.badgeBlocked}`}
                    title={photo.rejectedReason ?? undefined}
                  >
                    {t('photoPendingBadge')}
                  </span>
                ) : null}
              </div>
              {/* Апрув фото прямо здесь — раньше только из отдельной очереди,
                  и модератор терял контекст анкеты между решениями по фото. */}
              {!photo.isApproved ? (
                rejectingPhotoId === photo.id ? (
                  <div className={styles.reasonBox}>
                    <textarea
                      className={styles.textarea}
                      value={photoReason}
                      onChange={(event) => setPhotoReason(event.target.value)}
                      placeholder={t('reason')}
                      minLength={5}
                    />
                    <span className={styles.hint}>{t('reasonHint')}</span>
                    <div className={styles.cardActions} style={{ padding: 0 }}>
                      <Button
                        disabled={busy || photoReason.trim().length < 5}
                        onClick={() =>
                          rejectPhotoM.mutate({ id: photo.id, reason: photoReason.trim() })
                        }
                      >
                        {t('reject')}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setRejectingPhotoId(null)}
                      >
                        {t('cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.cardActions}>
                    <Button disabled={busy} onClick={() => approvePhotoM.mutate(photo.id)}>
                      {t('approve')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setRejectingPhotoId(photo.id);
                        setPhotoReason('');
                      }}
                    >
                      {t('reject')}
                    </Button>
                  </div>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.staffList}>
        <div className={styles.staffRow}>
          <div className={styles.staffMain}>
            <span className={styles.staffEmail}>{t('params')}</span>
            <span className={styles.staffMeta}>{params.map(([, value]) => value).join(' · ')}</span>
          </div>
        </div>

        <div className={styles.staffRow}>
          <div className={styles.staffMain}>
            <span className={styles.staffEmail}>{t('description')}</span>
            <span className={styles.staffMeta}>
              {profile.description.trim() || t('noDescription')}
            </span>
          </div>
        </div>

        {profile.services.length > 0 ? (
          <div className={styles.staffRow}>
            <div className={styles.staffMain}>
              <span className={styles.staffEmail}>{t('services')}</span>
              <span className={styles.staffMeta}>
                {profile.services.map((service) => service.name).join(', ')}
              </span>
            </div>
          </div>
        ) : null}

        {profile.prices.length > 0 ? (
          <div className={styles.staffRow}>
            <div className={styles.staffMain}>
              <span className={styles.staffEmail}>{t('prices')}</span>
              <span className={styles.staffMeta}>
                {profile.prices
                  .map(
                    (p) =>
                      `${p.durationMinutes} мин — ${euro(p.incallCents)} / ${euro(p.outcallCents)}`,
                  )
                  .join(' · ')}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
