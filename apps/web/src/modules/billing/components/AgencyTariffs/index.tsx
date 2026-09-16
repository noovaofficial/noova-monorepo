'use client';

import {
  type AgencyTariffTier,
  type AgencyTariffTierInput,
  agencyTariffTierInputSchema,
  PLAN_TERMS,
  type PlanTerm,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  BillingError,
  createAgencyTariffTier,
  deleteAgencyTariffTier,
  fetchAgencyTariffGrid,
  updateAgencyTariffTier,
} from '@/modules/billing/api';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import sharedStyles from '../MonetizationSettings/MonetizationSettings.module.css';
import styles from './AgencyTariffs.module.css';

const TERM_LABEL: Record<PlanTerm, 'term1' | 'term6' | 'term12'> = {
  m1: 'term1',
  m6: 'term6',
  m12: 'term12',
};

const num = (value: string): number => Number(value.replace(',', '.')) || 0;

type TierRow = {
  /** Ключ React: id тарифа, либо временный — у ещё не сохранённой строки. */
  key: string;
  id: string | null;
  name: string;
  minProfiles: string;
  maxProfiles: string;
  isDefault: boolean;
  isActive: boolean;
  prices: Record<PlanTerm, string>;
};

function fromTier(tier: AgencyTariffTier): TierRow {
  return {
    key: tier.id,
    id: tier.id,
    name: tier.name,
    minProfiles: String(tier.minProfiles),
    maxProfiles: String(tier.maxProfiles),
    isDefault: tier.isDefault,
    isActive: tier.isActive,
    prices: {
      m1: String(tier.prices.m1),
      m6: String(tier.prices.m6),
      m12: String(tier.prices.m12),
    },
  };
}

let draftCounter = 0;
function blankTier(): TierRow {
  draftCounter += 1;
  return {
    key: `draft-${draftCounter}`,
    id: null,
    name: '',
    minProfiles: '',
    maxProfiles: '',
    isDefault: false,
    isActive: true,
    prices: { m1: '', m6: '', m12: '' },
  };
}

function toInput(row: TierRow): AgencyTariffTierInput {
  return {
    name: row.name.trim(),
    minProfiles: num(row.minProfiles),
    maxProfiles: num(row.maxProfiles),
    isDefault: row.isDefault,
    isActive: row.isActive,
    prices: { m1: num(row.prices.m1), m6: num(row.prices.m6), m12: num(row.prices.m12) },
  };
}

/**
 * Сетка тарифов агентств по числу анкет (payments.md §3.3, D-13 — заменяет
 * плоский тариф D-07). В отличие от бонусной лестницы монетизации, тарифы
 * CRUD-ятся по одной строке со своим id, а не перезаписываются все разом:
 * на них ссылаются компании, и слепой replace-all снял бы у агентств тариф
 * молча.
 */
export function AgencyTariffs() {
  const t = useTranslations('billing');
  const { user, status } = useSession();
  const router = useRouter();

  const isAdmin = user?.role === 'admin';
  const grid = useQuery({
    queryKey: queryKeys.agencyTariffGrid(),
    queryFn: fetchAgencyTariffGrid,
    enabled: status === 'authenticated' && isAdmin,
  });

  if (status === 'loading') return <p className={sharedStyles.empty}>{t('loading')}</p>;
  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }
  if (!isAdmin) return <p className={sharedStyles.empty}>{t('onlyAdmins')}</p>;
  if (grid.isError) return <p className={sharedStyles.empty}>{t('loadFailed')}</p>;
  if (!grid.data) return <p className={sharedStyles.empty}>{t('loading')}</p>;

  return <AgencyTariffsForm key={grid.dataUpdatedAt} initial={grid.data} />;
}

function AgencyTariffsForm({ initial }: { initial: AgencyTariffTier[] }) {
  const t = useTranslations('billing');
  const queryClient = useQueryClient();

  const [rows, setRows] = useState<TierRow[]>(() => initial.map(fromTier));
  const [invalidKey, setInvalidKey] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.agencyTariffGrid() });

  const save = useMutation({
    mutationFn: (row: TierRow) =>
      row.id ? updateAgencyTariffTier(row.id, toInput(row)) : createAgencyTariffTier(toInput(row)),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAgencyTariffTier(id),
    onSuccess: invalidate,
  });

  const removeFailed =
    remove.isError && remove.error instanceof BillingError && remove.error.status === 409;
  const saveFailed = save.isError;

  function patch(key: string, patchFn: (row: TierRow) => TierRow) {
    setRows((prev) => prev.map((row) => (row.key === key ? patchFn(row) : row)));
  }

  function onSave(row: TierRow) {
    const parsed = agencyTariffTierInputSchema.safeParse(toInput(row));
    setInvalidKey(parsed.success ? null : row.key);
    if (parsed.success) save.mutate(row);
  }

  return (
    <div className={sharedStyles.wrap}>
      <div className={sharedStyles.head}>
        <h1 className={sharedStyles.title}>{t('agencyTariffsTitle')}</h1>
        <Button onClick={() => setRows((prev) => [...prev, blankTier()])}>{t('addTier')}</Button>
      </div>
      <p className={sharedStyles.lead}>{t('agencyTariffsLead')}</p>

      {removeFailed ? (
        <p className={`${sharedStyles.notice} ${sharedStyles.noticeError}`}>{t('tierInUse')}</p>
      ) : null}
      {saveFailed ? (
        <p className={`${sharedStyles.notice} ${sharedStyles.noticeError}`}>{t('saveFailed')}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className={sharedStyles.empty}>{t('tiersEmpty')}</p>
      ) : (
        rows.map((row) => (
          <TierEditor
            key={row.key}
            row={row}
            invalid={invalidKey === row.key}
            saving={save.isPending || remove.isPending}
            onChange={(next) => patch(row.key, () => next)}
            onSave={() => onSave(row)}
            onDelete={row.id ? () => remove.mutate(row.id as string) : undefined}
            onDiscard={
              row.id ? undefined : () => setRows((prev) => prev.filter((r) => r.key !== row.key))
            }
          />
        ))
      )}
    </div>
  );
}

function TierEditor({
  row,
  invalid,
  saving,
  onChange,
  onSave,
  onDelete,
  onDiscard,
}: {
  row: TierRow;
  invalid: boolean;
  saving: boolean;
  onChange: (row: TierRow) => void;
  onSave: () => void;
  onDelete?: () => void;
  onDiscard?: () => void;
}) {
  const t = useTranslations('billing');

  return (
    <section className={sharedStyles.section}>
      <div className={styles.tierHead}>
        <input
          className={`${sharedStyles.input} ${styles.nameField}`}
          value={row.name}
          placeholder={t('tierName')}
          aria-label={t('tierName')}
          onChange={(event) => onChange({ ...row, name: event.target.value })}
        />
        <label className={styles.checkboxField}>
          <input
            type="radio"
            name="agency-tariff-default"
            checked={row.isDefault}
            onChange={() => onChange({ ...row, isDefault: true })}
          />
          {t('tierIsDefault')}
        </label>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={row.isActive}
            onChange={(event) => onChange({ ...row, isActive: event.target.checked })}
          />
          {t('tierIsActive')}
        </label>
      </div>

      <div className={styles.rangeRow}>
        <div className={sharedStyles.field}>
          <span className={sharedStyles.label}>{t('tierMinProfiles')}</span>
          <input
            className={`${sharedStyles.input} ${sharedStyles.narrow}`}
            inputMode="numeric"
            value={row.minProfiles}
            onChange={(event) => onChange({ ...row, minProfiles: event.target.value })}
          />
        </div>
        <div className={sharedStyles.field}>
          <span className={sharedStyles.label}>{t('tierMaxProfiles')}</span>
          <input
            className={`${sharedStyles.input} ${sharedStyles.narrow}`}
            inputMode="numeric"
            value={row.maxProfiles}
            onChange={(event) => onChange({ ...row, maxProfiles: event.target.value })}
          />
        </div>
      </div>

      <div className={`${sharedStyles.grid} ${sharedStyles.tiers}`}>
        {PLAN_TERMS.map((term) => (
          <div className={sharedStyles.field} key={term}>
            <span className={sharedStyles.label}>{t(TERM_LABEL[term])}</span>
            <input
              className={sharedStyles.input}
              inputMode="numeric"
              aria-label={t(TERM_LABEL[term])}
              value={row.prices[term]}
              onChange={(event) =>
                onChange({ ...row, prices: { ...row.prices, [term]: event.target.value } })
              }
            />
          </div>
        ))}
      </div>

      {invalid ? (
        <p className={`${sharedStyles.notice} ${sharedStyles.noticeError}`}>{t('invalidConfig')}</p>
      ) : null}

      <div className={styles.actions}>
        <Button onClick={onSave} disabled={saving}>
          {t('saveTier')}
        </Button>
        {onDelete ? (
          <Button variant="secondary" onClick={onDelete} disabled={saving}>
            {t('deleteTier')}
          </Button>
        ) : null}
        {onDiscard ? (
          <Button variant="secondary" onClick={onDiscard} disabled={saving}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
