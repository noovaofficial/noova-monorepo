'use client';

import { PLACEMENT_KINDS, type PlacementRule } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPlacementRules, savePlacementRule } from '@/modules/locations/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Locations.module.css';
import type { Runner, Translate } from '../shared';

type Scope = { countryId: string } | { cityId: string };
type Kind = (typeof PLACEMENT_KINDS)[number];

const KIND_LABEL = {
  individual: 'kindIndividual',
  salon: 'kindSalon',
  agency: 'kindAgency',
} as const satisfies Record<Kind, string>;

/** null в правиле — «не переопределено»; в селекте это значение `inherit`. */
const toValue = (value: boolean | null | undefined) =>
  value === null || value === undefined ? 'inherit' : String(value);
const fromValue = (value: string): boolean | null =>
  value === 'inherit' ? null : value === 'true';

/**
 * Правила размещения страны или города: для каждого типа рекламодателя —
 * платное ли размещение и разрешено ли оно вовсе. Город переопределяет страну,
 * поэтому «как задано выше» у города значит «как в стране».
 */
export function PlacementRules({ scope, run, t }: { scope: Scope; run: Runner; t: Translate }) {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: queryKeys.placementRules(), queryFn: fetchPlacementRules });

  const own = (kind: Kind): PlacementRule | undefined =>
    (rules.data ?? []).find(
      (rule) =>
        rule.kind === kind &&
        ('countryId' in scope ? rule.countryId === scope.countryId : rule.cityId === scope.cityId),
    );

  const save = useMutation({
    mutationFn: (input: { kind: Kind; paid: boolean | null; allowed: boolean | null }) =>
      run(
        () => savePlacementRule({ ...scope, ...input }),
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.placementRules() });
        },
      ),
  });

  return (
    <div className={styles.form}>
      <p className={styles.hint}>{t('placementLead')}</p>
      {PLACEMENT_KINDS.map((kind) => {
        const rule = own(kind);
        const paid = rule?.paid ?? null;
        const allowed = rule?.allowed ?? null;
        return (
          <div className={styles.formRow} key={kind}>
            <div className={styles.field}>
              <span className={styles.label}>{t(KIND_LABEL[kind])}</span>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`pl-paid-${kind}`}>
                {t('placementPaid')}
              </label>
              <select
                className={styles.select}
                id={`pl-paid-${kind}`}
                value={toValue(paid)}
                disabled={save.isPending}
                onChange={(event) =>
                  save.mutate({ kind, paid: fromValue(event.target.value), allowed })
                }
              >
                <option value="inherit">{t('placementInherit')}</option>
                <option value="true">{t('placementPaidYes')}</option>
                <option value="false">{t('placementPaidNo')}</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`pl-allowed-${kind}`}>
                {t('placementAllowed')}
              </label>
              <select
                className={styles.select}
                id={`pl-allowed-${kind}`}
                value={toValue(allowed)}
                disabled={save.isPending}
                onChange={(event) =>
                  save.mutate({ kind, paid, allowed: fromValue(event.target.value) })
                }
              >
                <option value="inherit">{t('placementInherit')}</option>
                <option value="true">{t('placementAllowedYes')}</option>
                <option value="false">{t('placementAllowedNo')}</option>
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
