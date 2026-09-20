'use client';

import {
  adjustBalanceInputSchema,
  isAdjustWithinLimit,
  PLAN_TERMS,
  type PlanTerm,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import {
  blockCompany,
  fetchCompanyTariff,
  fetchCompanyTop,
  grantCompanyTop,
  saveCompanyTariff,
  unblockCompany,
} from '@/modules/agencies/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  adjustBalance,
  BillingError,
  fetchAdjustLimit,
  fetchAgencyTariffGrid,
} from '@/modules/billing/api';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import { deleteUser, verifyUserEmail } from '@/modules/moderation/api';
import { ActionCard } from '@/modules/moderation/components/ActionCard';
import cardStyles from '@/modules/moderation/components/ActionCard/ActionCard.module.css';
import {
  BlockIcon,
  DeleteIcon,
  TopIcon,
  UnblockIcon,
  VerifyIcon,
} from '@/modules/moderation/components/icons';
import moderationStyles from '@/modules/moderation/components/Moderation.module.css';
import { ProfileSummaryList } from '@/modules/moderation/components/ProfileSummaryList';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import sharedStyles from '../MonetizationSettings/MonetizationSettings.module.css';

const TERM_LABEL: Record<PlanTerm, 'term1' | 'term6' | 'term12'> = {
  m1: 'term1',
  m6: 'term6',
  m12: 'term12',
};

const NO_TIER = '';

/**
 * Карточка агентства целиком: тариф/лимит (только админ — деньги проекта),
 * бан и ТОП (модератор и админ) и монеты/удаление аккаунта владельца.
 * Одна страница вместо нескольких — админ и модератор находят агентство
 * один раз и решают всё, не переключаясь между разделами.
 */
export function AgencyTariffDetail({ companyId }: { companyId: string }) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { user } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin';
  const isStaff = isAdmin || user?.role === 'moderator';

  const state = useQuery({
    queryKey: queryKeys.companyTariff(companyId),
    queryFn: () => fetchCompanyTariff(companyId),
  });
  // Сетка тарифов и ТОП агентства — денежные решения, только админу: у
  // модератора запрос отключён, а не просто спрятан результат.
  const grid = useQuery({
    queryKey: queryKeys.agencyTariffGrid(),
    queryFn: fetchAgencyTariffGrid,
    enabled: isAdmin,
  });
  const top = useQuery({
    queryKey: queryKeys.companyTop(companyId),
    queryFn: () => fetchCompanyTop(companyId),
    enabled: isAdmin,
  });
  const adjustLimit = useQuery({
    queryKey: queryKeys.adjustLimit(),
    queryFn: fetchAdjustLimit,
    enabled: isStaff,
    staleTime: 5 * 60 * 1000,
  });

  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [adjustedBalance, setAdjustedBalance] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.companyTariff(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companyTop(companyId) }),
    ]);

  const block = useMutation({
    mutationFn: () => blockCompany(companyId, reason.trim()),
    onSuccess: async () => {
      setBlocking(false);
      setReason('');
      await invalidate();
    },
  });

  const unblock = useMutation({
    mutationFn: () => unblockCompany(companyId),
    onSuccess: invalidate,
  });

  const verify = useMutation({
    mutationFn: (ownerId: string) => verifyUserEmail(ownerId),
    onSuccess: invalidate,
  });

  const grantTop = useMutation({
    mutationFn: () => grantCompanyTop(companyId),
    onSuccess: invalidate,
  });

  const adjustInput = (ownerId: string) =>
    adjustBalanceInputSchema.safeParse({
      userId: ownerId,
      gcAmount: Number(amount),
      note: note.trim(),
    });
  const limitGc = adjustLimit.data?.limitGc ?? null;
  const canSubmitAdjust = (ownerId: string) =>
    adjustInput(ownerId).success && isAdjustWithinLimit(Number(amount), limitGc);

  const adjust = useMutation({
    mutationFn: (ownerId: string) => {
      const parsed = adjustInput(ownerId);
      if (!parsed.success) throw new Error('invalid');
      return adjustBalance(parsed.data);
    },
    onSuccess: (result) => {
      setAdjusting(false);
      setAmount('');
      setNote('');
      setAdjustedBalance(result.balanceGc);
    },
  });

  const remove = useMutation({
    mutationFn: (ownerId: string) => deleteUser(ownerId),
    onSuccess: () => router.replace('/admin/companies'),
  });

  const save = useMutation({
    mutationFn: (input: {
      tariffTierId: string;
      customLimit: string;
      customPrices: Record<PlanTerm, string>;
    }) =>
      saveCompanyTariff(companyId, {
        tariffTierId: input.tariffTierId || null,
        customProfileLimit: input.customLimit.trim() === '' ? null : Number(input.customLimit),
        customPrices: {
          m1: input.customPrices.m1.trim() === '' ? null : Number(input.customPrices.m1),
          m6: input.customPrices.m6.trim() === '' ? null : Number(input.customPrices.m6),
          m12: input.customPrices.m12.trim() === '' ? null : Number(input.customPrices.m12),
        },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.companyTariff(companyId) }),
  });

  const [tariffTierId, setTariffTierId] = useState<string | null>(null);
  const [customLimit, setCustomLimit] = useState<string | null>(null);
  const [customPrices, setCustomPrices] = useState<Record<PlanTerm, string> | null>(null);

  if (state.isError) return <p className={sharedStyles.empty}>{t('loadFailed')}</p>;
  if (!state.data) return <p className={sharedStyles.empty}>{t('loading')}</p>;
  const data = state.data;

  // Форма тарифа инициализируется один раз от данных сервера, дальше живёт
  // локальным состоянием — так пересчёт после сохранения не затирает то,
  // что ещё не отправлено.
  const tierId = tariffTierId ?? data.tariffTier?.id ?? NO_TIER;
  const limitValue =
    customLimit ?? (data.customProfileLimit === null ? '' : String(data.customProfileLimit));
  const priceValues =
    customPrices ??
    ({
      m1: data.customPrices.m1 === null ? '' : String(data.customPrices.m1),
      m6: data.customPrices.m6 === null ? '' : String(data.customPrices.m6),
      m12: data.customPrices.m12 === null ? '' : String(data.customPrices.m12),
    } as Record<PlanTerm, string>);

  const busy =
    block.isPending ||
    unblock.isPending ||
    verify.isPending ||
    grantTop.isPending ||
    adjust.isPending ||
    remove.isPending;
  const adjustStatus = adjust.error instanceof BillingError ? adjust.error.status : null;

  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  // Детали аккаунта владельца — те же, что на карточке пользователя
  // (`UserDetail`): объединённая карточка агентства не должна отправлять за
  // ролью/почтой/датами на отдельную страницу.
  const accountRows: { label: string; value: string }[] = [
    { label: t('userRole'), value: t(`role_${data.ownerRole}`) },
    { label: t('userBalance'), value: t('balanceGc', { balance: data.ownerGlowcoinBalance }) },
    {
      label: t('userEmailState'),
      value: t(data.ownerEmailVerified ? 'emailVerified' : 'emailNotVerified'),
    },
    { label: t('userRegistered'), value: when(data.ownerCreatedAt) },
    { label: t('userLastLogin'), value: when(data.ownerLastLoginAt) },
    { label: t('userLocale'), value: data.ownerLocale.toUpperCase() },
  ];

  return (
    <div className={sharedStyles.wrap}>
      <div className={sharedStyles.head}>
        <h1 className={sharedStyles.title}>{data.companyName}</h1>
      </div>

      <p className={sharedStyles.hint}>
        {t('agencyProfileCount', { count: data.profileCount, limit: data.effectiveLimit })}
      </p>

      <div className={cardStyles.grid}>
        {/* Блокировка агентства — независимо от `isActive`, которым
            распоряжается сам владелец. Каскадом банит анкеты компании. */}
        <ActionCard
          icon={data.isBanned ? <UnblockIcon /> : <BlockIcon />}
          title={t('blockAgency')}
          status={
            data.isBanned
              ? `${t('agencyBlocked')}${data.banReason ? ` ${data.banReason}` : ''}`
              : undefined
          }
          tone={data.isBanned ? 'danger' : 'default'}
          expanded={blocking}
        >
          {data.isBanned ? (
            <div className={cardStyles.actions}>
              <Button variant="secondary" disabled={busy} onClick={() => unblock.mutate()}>
                <UnblockIcon />
                {t('unblockAgency')}
              </Button>
            </div>
          ) : blocking ? (
            <>
              <textarea
                className={sharedStyles.input}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('blockAgencyReason')}
                minLength={5}
              />
              <span className={sharedStyles.hint}>{t('blockAgencyHint')}</span>
              <div className={cardStyles.actions}>
                <Button disabled={busy || reason.trim().length < 5} onClick={() => block.mutate()}>
                  <BlockIcon />
                  {t('blockAgency')}
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
                {t('blockAgency')}
              </Button>
            </div>
          )}
        </ActionCard>

        {/* Подтверждение почты владельца вручную — обходит письмо, staff
            ручается за адрес вместо него. Кнопка видна всегда, дизейблена
            после подтверждения. */}
        {isStaff ? (
          <ActionCard
            icon={<VerifyIcon />}
            title={t('verifyEmail')}
            status={t(data.ownerEmailVerified ? 'emailVerified' : 'emailNotVerified')}
          >
            <div className={cardStyles.actions}>
              <Button
                variant="secondary"
                disabled={busy || data.ownerEmailVerified}
                onClick={() => verify.mutate(data.ownerId)}
              >
                <VerifyIcon />
                {t('verifyEmail')}
              </Button>
            </div>
          </ActionCard>
        ) : null}

        {/* ТОП агентства без оплаты — обход платежа, только админ. Кнопка
            видна всегда: когда выдать нельзя (уже в ТОПе, нет свободных мест),
            она задизейблена с подсказкой при наведении, а не молчаливо
            скрытая кнопка. В отличие от платной покупки (`AgencyTopCard`),
            публикация анкеты не требуется — бесплатной выдаче нечего
            защищать от траты впустую. */}
        {isAdmin && top.data ? (
          <ActionCard
            icon={<TopIcon />}
            title={t('topSection')}
            status={
              top.data.placement
                ? t('topActiveUntil', {
                    date: new Date(top.data.placement.expiresAt).toLocaleDateString(),
                  })
                : t('topInactive')
            }
          >
            <div className={cardStyles.actions}>
              <Button
                variant="secondary"
                disabled={busy || Boolean(top.data.placement) || top.data.freeSlots <= 0}
                title={
                  top.data.placement
                    ? t('topDisabledActive')
                    : top.data.freeSlots <= 0
                      ? t('topDisabledNoSlots')
                      : undefined
                }
                onClick={() => grantTop.mutate()}
              >
                <TopIcon />
                {t('grantTop')}
              </Button>
            </div>
            {grantTop.isError ? (
              <span className={sharedStyles.hint}>{t('topGrantFailed')}</span>
            ) : null}
          </ActionCard>
        ) : null}

        {/* Монеты владельца — staff, потолок для модератора проверяется и на сервере. */}
        {isStaff ? (
          <ActionCard icon={<GlowCoinIcon size={18} />} title={t('adjustGc')} expanded={adjusting}>
            {adjusting ? (
              <>
                <div className={sharedStyles.field}>
                  <label className={sharedStyles.label} htmlFor="agency-adjust-amount">
                    {t('adjustAmount')}
                  </label>
                  <input
                    className={sharedStyles.input}
                    id="agency-adjust-amount"
                    inputMode="numeric"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="+100"
                  />
                  <span className={sharedStyles.hint}>
                    {t('adjustAmountHint')}
                    {limitGc === null ? null : ` ${t('adjustLimitHint', { limit: limitGc })}`}
                  </span>
                </div>
                <div className={sharedStyles.field}>
                  <label className={sharedStyles.label} htmlFor="agency-adjust-note">
                    {t('adjustNote')}
                  </label>
                  <textarea
                    className={sharedStyles.input}
                    id="agency-adjust-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    minLength={3}
                  />
                  <span className={sharedStyles.hint}>{t('adjustNoteHint')}</span>
                </div>
                {adjustStatus === 409 ? (
                  <span className={sharedStyles.hint}>{t('adjustInsufficient')}</span>
                ) : adjustStatus === 403 ? (
                  <span className={sharedStyles.hint}>{t('adjustOverLimit')}</span>
                ) : null}
                <div className={cardStyles.actions}>
                  <Button
                    disabled={busy || !canSubmitAdjust(data.ownerId)}
                    onClick={() => adjust.mutate(data.ownerId)}
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
                  <span className={sharedStyles.hint}>
                    {t('adjustDone', { balance: adjustedBalance })}
                  </span>
                ) : null}
              </div>
            )}
          </ActionCard>
        ) : null}

        {/* Удалить учётку владельца — необратимо, только админ: уходит вся
            компания и все её анкеты разом, поэтому это действие только здесь,
            а не с карточки отдельной анкеты агентства. */}
        {isAdmin ? (
          <ActionCard
            icon={<DeleteIcon />}
            title={t('deleteUser')}
            tone="danger"
            expanded={deleting}
          >
            {deleting ? (
              <>
                <span className={sharedStyles.hint}>{t('deleteUserHint')}</span>
                <div className={cardStyles.actions}>
                  <Button disabled={busy} onClick={() => remove.mutate(data.ownerId)}>
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

      <dl className={moderationStyles.userRows}>
        {accountRows.map((row) => (
          <div className={moderationStyles.userRow} key={row.label}>
            <dt className={moderationStyles.userLabel}>{row.label}</dt>
            <dd className={moderationStyles.userValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {data.profiles ? (
        <ProfileSummaryList
          profiles={data.profiles}
          title={t('agencyProfilesTitle', { count: data.profiles.length })}
          emptyText={t('agencyProfilesEmpty')}
          statusLabel={(profileStatus) => t(`profileStatus_${profileStatus}`)}
          verifiedLabel={t('agencyProfileVerified')}
          featuredLabel={t('agencyProfileFeatured')}
          openLabel={t('openProfile')}
        />
      ) : null}

      {/* Тариф по числу анкет (D-13) и индивидуальный override — деньги
          проекта, видит и правит только админ. */}
      {isAdmin ? (
        <>
          <div className={sharedStyles.head}>
            <h2 className={sharedStyles.sectionTitle}>{t('agencyDetailTier')}</h2>
            <Button
              onClick={() =>
                save.mutate({
                  tariffTierId: tierId,
                  customLimit: limitValue,
                  customPrices: priceValues,
                })
              }
              disabled={save.isPending || !grid.data}
            >
              {t('save')}
            </Button>
          </div>

          {save.isSuccess && !save.isPending ? (
            <p className={`${sharedStyles.notice} ${sharedStyles.noticeOk}`}>{t('saved')}</p>
          ) : null}
          {save.isError ? (
            <p className={`${sharedStyles.notice} ${sharedStyles.noticeError}`}>
              {t('saveFailed')}
            </p>
          ) : null}

          {!grid.data ? (
            <p className={sharedStyles.hint}>{t('loading')}</p>
          ) : (
            <>
              <section className={sharedStyles.section}>
                <div className={sharedStyles.field}>
                  <label className={sharedStyles.label} htmlFor="tariff-tier">
                    {t('agencyDetailTier')}
                  </label>
                  <select
                    className={sharedStyles.input}
                    id="tariff-tier"
                    value={tierId}
                    onChange={(event) => setTariffTierId(event.target.value)}
                  >
                    <option value={NO_TIER}>{t('agencyDetailNoTier')}</option>
                    {grid.data.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} ({tier.minProfiles}–{tier.maxProfiles})
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className={sharedStyles.section}>
                <h2 className={sharedStyles.sectionTitle}>{t('agencyDetailCustomLimit')}</h2>
                <p className={sharedStyles.hint}>{t('agencyDetailUseTier')}</p>

                <div className={sharedStyles.field}>
                  <label className={sharedStyles.label} htmlFor="custom-limit">
                    {t('agencyDetailCustomLimit')}
                  </label>
                  <input
                    className={`${sharedStyles.input} ${sharedStyles.narrow}`}
                    id="custom-limit"
                    inputMode="numeric"
                    value={limitValue}
                    onChange={(event) => setCustomLimit(event.target.value)}
                    placeholder={t('agencyDetailUseTier')}
                  />
                </div>
              </section>

              <section className={sharedStyles.section}>
                <h2 className={sharedStyles.sectionTitle}>{t('agencyDetailCustomPrice')}</h2>
                <p className={sharedStyles.hint}>{t('agencyDetailUseTier')}</p>

                <div className={`${sharedStyles.grid} ${sharedStyles.tiers}`}>
                  {PLAN_TERMS.map((term) => (
                    <div className={sharedStyles.field} key={term}>
                      <span className={sharedStyles.label}>{t(TERM_LABEL[term])}</span>
                      <input
                        className={sharedStyles.input}
                        inputMode="numeric"
                        aria-label={t(TERM_LABEL[term])}
                        value={priceValues[term]}
                        placeholder={t('agencyDetailUseTier')}
                        onChange={(event) =>
                          setCustomPrices((prev) => ({
                            ...(prev ?? priceValues),
                            [term]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
