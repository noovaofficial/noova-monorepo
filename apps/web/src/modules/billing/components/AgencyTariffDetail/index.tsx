'use client';

import { PLAN_TERMS, type PlanTerm } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { fetchCompanyTariff, saveCompanyTariff } from '@/modules/agencies/api';
import { fetchAgencyTariffGrid } from '@/modules/billing/api';
import { queryKeys } from '@/shared/query-keys';
import sharedStyles from '../MonetizationSettings/MonetizationSettings.module.css';

const TERM_LABEL: Record<PlanTerm, 'term1' | 'term6' | 'term12'> = {
  m1: 'term1',
  m6: 'term6',
  m12: 'term12',
};

const NO_TIER = '';

export function AgencyTariffDetail({ companyId }: { companyId: string }) {
  const t = useTranslations('billing');
  const queryClient = useQueryClient();

  const state = useQuery({
    queryKey: queryKeys.companyTariff(companyId),
    queryFn: () => fetchCompanyTariff(companyId),
  });
  const grid = useQuery({ queryKey: queryKeys.agencyTariffGrid(), queryFn: fetchAgencyTariffGrid });

  if (state.isError || grid.isError) {
    return <p className={sharedStyles.empty}>{t('loadFailed')}</p>;
  }
  if (!state.data || !grid.data) return <p className={sharedStyles.empty}>{t('loading')}</p>;

  return (
    <AgencyTariffDetailForm
      key={state.dataUpdatedAt}
      companyId={companyId}
      initial={state.data}
      grid={grid.data}
      onSaved={() =>
        queryClient.invalidateQueries({ queryKey: queryKeys.companyTariff(companyId) })
      }
    />
  );
}

function AgencyTariffDetailForm({
  companyId,
  initial,
  grid,
  onSaved,
}: {
  companyId: string;
  initial: Awaited<ReturnType<typeof fetchCompanyTariff>>;
  grid: Awaited<ReturnType<typeof fetchAgencyTariffGrid>>;
  onSaved: () => void;
}) {
  const t = useTranslations('billing');

  const [tariffTierId, setTariffTierId] = useState(initial.tariffTier?.id ?? NO_TIER);
  const [customLimit, setCustomLimit] = useState(
    initial.customProfileLimit === null ? '' : String(initial.customProfileLimit),
  );
  const [customPrices, setCustomPrices] = useState<Record<PlanTerm, string>>({
    m1: initial.customPrices.m1 === null ? '' : String(initial.customPrices.m1),
    m6: initial.customPrices.m6 === null ? '' : String(initial.customPrices.m6),
    m12: initial.customPrices.m12 === null ? '' : String(initial.customPrices.m12),
  });

  const save = useMutation({
    mutationFn: () =>
      saveCompanyTariff(companyId, {
        tariffTierId: tariffTierId || null,
        customProfileLimit: customLimit.trim() === '' ? null : Number(customLimit),
        customPrices: {
          m1: customPrices.m1.trim() === '' ? null : Number(customPrices.m1),
          m6: customPrices.m6.trim() === '' ? null : Number(customPrices.m6),
          m12: customPrices.m12.trim() === '' ? null : Number(customPrices.m12),
        },
      }),
    onSuccess: onSaved,
  });

  return (
    <div className={sharedStyles.wrap}>
      <div className={sharedStyles.head}>
        <h1 className={sharedStyles.title}>{initial.companyName}</h1>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {t('save')}
        </Button>
      </div>

      <p className={sharedStyles.hint}>
        {t('agencyProfileCount', {
          count: initial.profileCount,
          limit: initial.effectiveLimit,
        })}
      </p>

      {save.isSuccess && !save.isPending ? (
        <p className={`${sharedStyles.notice} ${sharedStyles.noticeOk}`}>{t('saved')}</p>
      ) : null}
      {save.isError ? (
        <p className={`${sharedStyles.notice} ${sharedStyles.noticeError}`}>{t('saveFailed')}</p>
      ) : null}

      <section className={sharedStyles.section}>
        <h2 className={sharedStyles.sectionTitle}>{t('agencyDetailTier')}</h2>

        <div className={sharedStyles.field}>
          <label className={sharedStyles.label} htmlFor="tariff-tier">
            {t('agencyDetailTier')}
          </label>
          <select
            className={sharedStyles.input}
            id="tariff-tier"
            value={tariffTierId}
            onChange={(event) => setTariffTierId(event.target.value)}
          >
            <option value={NO_TIER}>{t('agencyDetailNoTier')}</option>
            {grid.map((tier) => (
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
            value={customLimit}
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
                value={customPrices[term]}
                placeholder={t('agencyDetailUseTier')}
                onChange={(event) =>
                  setCustomPrices((prev) => ({ ...prev, [term]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
