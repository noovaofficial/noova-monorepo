'use client';

import { type AgencyPaywallInfo, PLAN_TERMS, type PlanTerm } from '@noova/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/design-system/components/Button';
import { AgencyError, upgradeOwnCompanyTariff } from '@/modules/agencies/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';

const TERM_LABEL: Record<PlanTerm, 'term1' | 'term6' | 'term12'> = {
  m1: 'term1',
  m6: 'term6',
  m12: 'term12',
};

/**
 * Пейвол при попытке создать анкету сверх тарифа (payments.md §3.3, D-13):
 * тарифы-кандидаты с доплатой за остаток оплаченного периода — агентство
 * повышает тариф прямо здесь, без отдельной заявки.
 */
export function AgencyPaywallNotice({
  info,
  onUpgraded,
}: {
  info: AgencyPaywallInfo;
  onUpgraded: () => void;
}) {
  const t = useTranslations('account');
  const queryClient = useQueryClient();

  const upgrade = useMutation({
    mutationFn: (params: { tierId: string; term: PlanTerm }) => upgradeOwnCompanyTariff(params),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownCompanyTariff() });
      onUpgraded();
    },
  });

  const insufficientBalance = upgrade.error instanceof AgencyError && upgrade.error.status === 409;

  return (
    <div className={`${styles.notice} ${styles.noticeWarn}`}>
      <p>{t('paywallTitle', { count: info.currentProfileCount, limit: info.effectiveLimit })}</p>
      <p className={styles.hint}>
        {info.currentTier
          ? t('paywallCurrentTier', { name: info.currentTier.name })
          : t('paywallNoTier')}
      </p>

      {upgrade.isError ? (
        <p className={styles.noticeError}>
          {insufficientBalance ? t('paywallInsufficientBalance') : t('paywallUpgradeFailed')}
        </p>
      ) : null}

      {info.candidateTiers.length === 0 ? null : (
        <div className={styles.list}>
          {info.candidateTiers.map((candidate) => (
            <div className={styles.card} key={candidate.tier.id}>
              <div className={styles.cardMain}>
                <span className={styles.cardName}>{candidate.tier.name}</span>
                <span className={styles.cardMeta}>
                  {t('paywallUpTo', { limit: candidate.tier.maxProfiles })}
                </span>
              </div>
              <div className={styles.cardActions}>
                {PLAN_TERMS.map((term) => (
                  <Button
                    key={term}
                    variant="secondary"
                    disabled={upgrade.isPending}
                    onClick={() => upgrade.mutate({ tierId: candidate.tier.id, term })}
                  >
                    {t(TERM_LABEL[term])} ·{' '}
                    {t('paywallUpgradeCost', { gc: candidate.upgradeCostGc[term] })}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
