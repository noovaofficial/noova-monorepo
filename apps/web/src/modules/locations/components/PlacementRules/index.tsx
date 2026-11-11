'use client';

import { PLACEMENT_KINDS, type PlacementRule } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import {
  fetchPlacementRules,
  fetchPublishedCount,
  pausePublished,
  savePlacementRule,
} from '@/modules/locations/api';
import { Overlay } from '@/overlays/Overlay';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Locations.module.css';
import type { Runner, Translate } from '../shared';

/** У города нужен ещё и `countryId`: «как в стране» показывает значение из правила страны. */
type Scope = { countryId: string } | { cityId: string; countryId: string };
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
  const locale = useLocale();
  const queryClient = useQueryClient();
  // Выключение публикации при наличии опубликованных анкет требует решения.
  const [pending, setPending] = useState<{
    kind: Kind;
    paid: boolean | null;
    count: number;
  } | null>(null);
  const rules = useQuery({ queryKey: queryKeys.placementRules(), queryFn: fetchPlacementRules });

  const own = (kind: Kind): PlacementRule | undefined =>
    (rules.data ?? []).find(
      (rule) =>
        rule.kind === kind &&
        ('cityId' in scope ? rule.cityId === scope.cityId : rule.countryId === scope.countryId),
    );

  // Что получится при «не задано»: у страны — умолчание (платно, разрешено),
  // у города — правило страны, а если и там пусто, то то же умолчание.
  const inherited = (kind: Kind) => {
    if (!('cityId' in scope)) return { paid: true, allowed: true };
    const countryRule = (rules.data ?? []).find(
      (rule) => rule.kind === kind && rule.countryId === scope.countryId,
    );
    return { paid: countryRule?.paid ?? true, allowed: countryRule?.allowed ?? true };
  };
  const inheritKey = 'cityId' in scope ? 'placementInheritCountry' : 'placementInheritDefault';
  const lower = (text: string) => text.toLocaleLowerCase(locale);

  const save = useMutation({
    mutationFn: (input: { kind: Kind; paid: boolean | null; allowed: boolean | null }) =>
      run(
        () =>
          savePlacementRule({
            // Для города страна нужна только для подписи — серверу уходит одно из двух.
            ...('cityId' in scope ? { cityId: scope.cityId } : { countryId: scope.countryId }),
            ...input,
          }),
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.placementRules() });
        },
      ),
  });

  const scopeBody: { countryId: string } | { cityId: string } =
    'cityId' in scope ? { cityId: scope.cityId } : { countryId: scope.countryId };

  /** Выключаем публикацию: сначала узнаём, есть ли что снимать. */
  async function disablePublishing(kind: Kind, paid: boolean | null) {
    const count = await run(() => fetchPublishedCount(scopeBody, kind));
    if (!count) {
      save.mutate({ kind, paid, allowed: false });
      return;
    }
    setPending({ kind, paid, count });
  }

  const confirm = useMutation({
    mutationFn: async (pause: boolean) => {
      if (!pending) return;
      await run(() =>
        savePlacementRule({ ...scopeBody, kind: pending.kind, paid: pending.paid, allowed: false }),
      );
      if (pause) await run(() => pausePublished(scopeBody, pending.kind));
      await queryClient.invalidateQueries({ queryKey: queryKeys.placementRules() });
      setPending(null);
    },
  });

  return (
    <div className={styles.form}>
      <p className={styles.hint}>{t('placementLead')}</p>
      {PLACEMENT_KINDS.map((kind) => {
        const rule = own(kind);
        const paid = rule?.paid ?? null;
        const allowed = rule?.allowed ?? null;
        const fallback = inherited(kind);
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
                <option value="inherit">
                  {t(inheritKey, {
                    value: lower(t(fallback.paid ? 'placementPaidYes' : 'placementPaidNo')),
                  })}
                </option>
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
                onChange={(event) => {
                  const next = fromValue(event.target.value);
                  if (next === false) void disablePublishing(kind, paid);
                  else save.mutate({ kind, paid, allowed: next });
                }}
              >
                <option value="inherit">
                  {t(inheritKey, {
                    value: lower(
                      t(fallback.allowed ? 'placementAllowedYes' : 'placementAllowedNo'),
                    ),
                  })}
                </option>
                <option value="true">{t('placementAllowedYes')}</option>
                <option value="false">{t('placementAllowedNo')}</option>
              </select>
            </div>
          </div>
        );
      })}

      {pending ? (
        <Overlay onClose={() => setPending(null)}>
          <div
            className={styles.dialogWrap}
            role="dialog"
            aria-modal="true"
            aria-label={t('pauseTitle')}
          >
            <button
              type="button"
              className={styles.dialogBackdrop}
              onClick={() => setPending(null)}
              aria-label={t('pauseCancel')}
            />
            <div className={styles.dialogCard}>
              <span className={styles.dialogTitle}>{t('pauseTitle')}</span>
              <p className={styles.hint}>
                {t('pauseBody', { count: pending.count, kind: t(KIND_LABEL[pending.kind]) })}
              </p>
              <div className={styles.dialogActions}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={confirm.isPending}
                  onClick={() => setPending(null)}
                >
                  {t('pauseCancel')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate(false)}
                >
                  {t('pauseKeep')}
                </Button>
                <Button
                  type="button"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate(true)}
                >
                  {t('pauseAll')}
                </Button>
              </div>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
