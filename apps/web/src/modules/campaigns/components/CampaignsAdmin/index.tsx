'use client';

import {
  type AdvertiserKind,
  CAMPAIGN_TRIGGERS,
  type Campaign,
  type CampaignInput,
  type CampaignTrigger,
  campaignInputSchema,
  type Locale,
  PLAN_KINDS,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  CampaignError,
  createCampaign,
  deleteCampaign,
  fetchCampaigns,
  updateCampaign,
} from '@/modules/campaigns/api';
import { fetchCities } from '@/modules/locations/api';
import { useRouter } from '@/shared/i18n/navigation';
import { useLabel } from '@/shared/i18n/use-label';
import { queryKeys } from '@/shared/query-keys';
import styles from './Campaigns.module.css';

const ADVERTISER_LABEL: Record<AdvertiserKind, string> = {
  individual: 'advertiserIndividual',
  salon: 'advertiserSalon',
  agency: 'advertiserAgency',
};

type FormState = {
  id: string | null;
  name: string;
  trigger: CampaignTrigger;
  code: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  cityId: string;
  advertiserKind: string;
  quota: string;
  rewardGc: string;
  rewardDays: string;
};

const EMPTY: FormState = {
  id: null,
  name: '',
  trigger: 'first_profile',
  code: '',
  isActive: true,
  startsAt: '',
  endsAt: '',
  cityId: '',
  advertiserKind: '',
  quota: '',
  rewardGc: '0',
  rewardDays: '0',
};

/** Пустое поле — это «без ограничения», а не ноль: их нельзя путать. */
const optionalInt = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
};

/**
 * `<input type="date">` отдаёт «2026-09-03», контракт ждёт момент времени.
 * Начало берём по местной полуночи, конец — по полуночи следующего дня:
 * «акция до 30 сентября» в понимании человека включает само 30-е.
 */
const toStart = (value: string): string | null =>
  value === '' ? null : new Date(`${value}T00:00:00`).toISOString();
const toEnd = (value: string): string | null =>
  value === '' ? null : new Date(`${value}T00:00:00`).toISOString();

const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

function toInput(form: FormState): unknown {
  return {
    name: form.name,
    trigger: form.trigger,
    code: form.trigger === 'promo_code' ? form.code : null,
    isActive: form.isActive,
    startsAt: toStart(form.startsAt),
    endsAt: toEnd(form.endsAt),
    cityId: form.cityId === '' ? null : form.cityId,
    advertiserKind: form.advertiserKind === '' ? null : form.advertiserKind,
    quota: optionalInt(form.quota),
    rewardGc: Number(form.rewardGc) || 0,
    rewardListingDays: Number(form.rewardDays) || 0,
  };
}

function fromCampaign(campaign: Campaign): FormState {
  return {
    id: campaign.id,
    name: campaign.name,
    trigger: campaign.trigger,
    code: campaign.code ?? '',
    isActive: campaign.isActive,
    startsAt: toDateInput(campaign.startsAt),
    endsAt: toDateInput(campaign.endsAt),
    cityId: campaign.cityId ?? '',
    advertiserKind: campaign.advertiserKind ?? '',
    quota: campaign.quota === null ? '' : String(campaign.quota),
    rewardGc: String(campaign.rewardGc),
    rewardDays: String(campaign.rewardListingDays),
  };
}

/**
 * Акции: кому, при каком условии и что выдаём.
 *
 * Только администратору. Раздача размещений и монет — решение владельца
 * продукта, а не операционная работа очереди: тем же рассуждением закрыты
 * «Монетизация» и «Операции».
 */
export function CampaignsAdmin() {
  const t = useTranslations('campaigns');
  // Типы размещения подписаны так же, как при регистрации: это один и тот же
  // выбор, и синоним читался бы как другой тариф.
  const ta = useTranslations('auth');
  const locale = useLocale() as Locale;
  const label = useLabel();
  const { user, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [invalid, setInvalid] = useState(false);

  const isAdmin = user?.role === 'admin';

  const campaigns = useQuery({
    queryKey: queryKeys.campaigns(locale),
    queryFn: () => fetchCampaigns(locale),
    enabled: status === 'authenticated' && isAdmin,
  });

  /**
   * Список городов берём админский, а не публичный: акция ссылается на город
   * по идентификатору, а публичный список отдаёт только slug. Названия в нём
   * лежат всеми языками сразу — отсюда `label`.
   */
  const cities = useQuery({
    queryKey: queryKeys.adminCities(),
    queryFn: () => fetchCities(),
    enabled: status === 'authenticated' && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.campaigns(locale), exact: false });

  const save = useMutation({
    mutationFn: (input: CampaignInput) =>
      form.id ? updateCampaign(locale, form.id, input) : createCampaign(locale, input),
    onSuccess: async () => {
      setForm(EMPTY);
      await invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: (campaign: Campaign) =>
      updateCampaign(locale, campaign.id, {
        ...(toInput(fromCampaign(campaign)) as CampaignInput),
        isActive: !campaign.isActive,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (campaign: Campaign) => deleteCampaign(campaign.id),
    onSuccess: invalidate,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Той же схемой, что и сервер: ошибка называется до запроса, а не
    // приходит обратно безликим 400.
    const parsed = campaignInputSchema.safeParse(toInput(form));
    setInvalid(!parsed.success);
    if (parsed.success) save.mutate(parsed.data);
  }

  const conflict =
    (save.error instanceof CampaignError && save.error.status === 409) ||
    (remove.error instanceof CampaignError && remove.error.status === 409);
  const failed = (save.isError || remove.isError || toggle.isError) && !conflict;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
      </div>
      <p className={styles.hint}>{t('intro')}</p>

      {invalid ? <p className={`${styles.notice} ${styles.noticeError}`}>{t('invalid')}</p> : null}
      {conflict ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>
          {(save.error ?? remove.error) instanceof CampaignError
            ? ((save.error ?? remove.error) as CampaignError).message
            : t('actionFailed')}
        </p>
      ) : null}
      {failed ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('actionFailed')}</p>
      ) : null}

      {campaigns.isPending ? <p className={styles.empty}>{t('loading')}</p> : null}
      {campaigns.isError ? <p className={styles.empty}>{t('loadFailed')}</p> : null}

      {campaigns.data?.length === 0 ? <p className={styles.empty}>{t('empty')}</p> : null}

      <div className={styles.list}>
        {(campaigns.data ?? []).map((campaign) => {
          const exhausted = campaign.quota !== null && campaign.grantedCount >= campaign.quota;
          return (
            <div
              className={`${styles.row} ${campaign.isActive ? '' : styles.rowOff}`}
              key={campaign.id}
            >
              <div className={styles.rowMain}>
                <div className={styles.rowName}>
                  {campaign.name}
                  {campaign.code ? (
                    <>
                      {' '}
                      · <span className={styles.code}>{campaign.code}</span>
                    </>
                  ) : null}
                </div>
                <div className={styles.rowMeta}>
                  {t(`trigger_${campaign.trigger}`)}
                  {' · '}
                  {campaign.cityName ? campaign.cityName : t('anyCity')}
                  {' · '}
                  {campaign.advertiserKind
                    ? ta(ADVERTISER_LABEL[campaign.advertiserKind])
                    : t('anyKind')}
                  {' · '}
                  {t('reward', {
                    gc: campaign.rewardGc,
                    days: campaign.rewardListingDays,
                  })}
                </div>
              </div>

              <span className={`${styles.progress} ${exhausted ? styles.progressDone : ''}`}>
                {campaign.quota === null
                  ? t('grantedNoQuota', { count: campaign.grantedCount })
                  : t('grantedOfQuota', {
                      count: campaign.grantedCount,
                      quota: campaign.quota,
                    })}
              </span>

              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => setForm(fromCampaign(campaign))}>
                  {t('edit')}
                </Button>
                <Button variant="secondary" onClick={() => toggle.mutate(campaign)}>
                  {t(campaign.isActive ? 'disable' : 'enable')}
                </Button>
                {/* Удаление только у нетронутой акции: выдачи — журнал того,
                    кому и что мы подарили, и стирать его каскадом нельзя.
                    Отработавшую акцию выключают. */}
                {campaign.grantedCount === 0 ? (
                  <Button variant="secondary" onClick={() => remove.mutate(campaign)}>
                    {t('delete')}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <form className={styles.form} onSubmit={onSubmit}>
        <h2 className={styles.formTitle}>{t(form.id ? 'editTitle' : 'createTitle')}</h2>

        <div className={styles.grid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-name">
              {t('name')}
            </label>
            <input
              className={styles.input}
              id="campaign-name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <span className={styles.fieldHint}>{t('nameHint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-trigger">
              {t('trigger')}
            </label>
            <select
              className={styles.select}
              id="campaign-trigger"
              value={form.trigger}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, trigger: event.target.value as CampaignTrigger }))
              }
            >
              {CAMPAIGN_TRIGGERS.map((value) => (
                <option key={value} value={value}>
                  {t(`trigger_${value}`)}
                </option>
              ))}
            </select>
            <span className={styles.fieldHint}>{t(`triggerHint_${form.trigger}`)}</span>
          </div>

          {/* Код только у акции по коду: у автоматической вводить его некуда,
              и поле лишь обещало бы способ её получить. */}
          {form.trigger === 'promo_code' ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="campaign-code">
                {t('code')}
              </label>
              <input
                className={styles.input}
                id="campaign-code"
                value={form.code}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
                }
              />
              <span className={styles.fieldHint}>{t('codeHint')}</span>
            </div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-city">
              {t('city')}
            </label>
            <select
              className={styles.select}
              id="campaign-city"
              value={form.cityId}
              onChange={(event) => setForm((prev) => ({ ...prev, cityId: event.target.value }))}
            >
              <option value="">{t('anyCity')}</option>
              {(cities.data ?? []).map((city) => (
                <option key={city.id} value={city.id}>
                  {label(city.name)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-kind">
              {t('advertiserKind')}
            </label>
            <select
              className={styles.select}
              id="campaign-kind"
              value={form.advertiserKind}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, advertiserKind: event.target.value }))
              }
            >
              <option value="">{t('anyKind')}</option>
              {PLAN_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ta(ADVERTISER_LABEL[kind])}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-quota">
              {t('quota')}
            </label>
            <input
              className={styles.input}
              id="campaign-quota"
              inputMode="numeric"
              value={form.quota}
              onChange={(event) => setForm((prev) => ({ ...prev, quota: event.target.value }))}
            />
            <span className={styles.fieldHint}>{t('quotaHint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-starts">
              {t('startsAt')}
            </label>
            <input
              className={styles.input}
              id="campaign-starts"
              type="date"
              value={form.startsAt}
              onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-ends">
              {t('endsAt')}
            </label>
            <input
              className={styles.input}
              id="campaign-ends"
              type="date"
              value={form.endsAt}
              onChange={(event) => setForm((prev) => ({ ...prev, endsAt: event.target.value }))}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-gc">
              {t('rewardGc')}
            </label>
            <input
              className={styles.input}
              id="campaign-gc"
              inputMode="numeric"
              value={form.rewardGc}
              onChange={(event) => setForm((prev) => ({ ...prev, rewardGc: event.target.value }))}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="campaign-days">
              {t('rewardDays')}
            </label>
            <input
              className={styles.input}
              id="campaign-days"
              inputMode="numeric"
              value={form.rewardDays}
              onChange={(event) => setForm((prev) => ({ ...prev, rewardDays: event.target.value }))}
            />
            <span className={styles.fieldHint}>{t('rewardDaysHint')}</span>
          </div>
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
          />
          {t('isActive')}
        </label>

        <div className={styles.actions} style={{ marginTop: 'var(--space4)' }}>
          <Button type="submit" disabled={save.isPending}>
            {t(form.id ? 'saveChanges' : 'create')}
          </Button>
          {form.id ? (
            <Button
              variant="secondary"
              onClick={() => {
                setForm(EMPTY);
                setInvalid(false);
              }}
            >
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
