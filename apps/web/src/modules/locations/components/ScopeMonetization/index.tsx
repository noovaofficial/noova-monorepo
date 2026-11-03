'use client';

import {
  type CityMonetization as CityMonetizationData,
  type CountryMonetization as CountryMonetizationData,
  cityMonetizationInputSchema,
  countryMonetizationSchema,
  PLAN_KINDS,
  PLAN_TERMS,
  type PlanKind,
  type PlanTerm,
  TERM_MONTHS,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { fetchBillingConfig } from '@/modules/billing/api';
import billing from '@/modules/billing/components/MonetizationSettings/MonetizationSettings.module.css';
import {
  fetchCityMonetization,
  fetchCountryMonetization,
  saveCityMonetization,
  saveCountryMonetization,
} from '@/modules/locations/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Locations.module.css';

/**
 * Агентство в сетке цен размещения не правится: его цена идёт тарифами
 * (блок «Тарифы агентств» страны). Значение для агентства сохраняется как
 * есть — схема требует полную сетку.
 */
const EDITABLE_KINDS = PLAN_KINDS.filter((kind) => kind !== 'agency');

const TERM_LABEL: Record<PlanTerm, 'term1' | 'term6' | 'term12'> = {
  m1: 'term1',
  m6: 'term6',
  m12: 'term12',
};

const KIND_LABEL: Record<
  PlanKind,
  'advertiserIndividual' | 'advertiserSalon' | 'advertiserAgency'
> = {
  individual: 'advertiserIndividual',
  salon: 'advertiserSalon',
  agency: 'advertiserAgency',
};

/** Поле держим строкой: очищенный инпут — пустая строка, а не ноль. */
const toNumber = (value: string): number => Number(value.replace(',', '.')) || 0;
const toNullable = (value: string): number | null => (value.trim() === '' ? null : toNumber(value));

/** Курс GC → евро нужен для подсказок «≈ € в месяц»; без него подсказки прячем. */
function useGcPerEur(): number {
  const config = useQuery({ queryKey: queryKeys.billingConfig(), queryFn: fetchBillingConfig });
  return config.data?.gcPerEur ?? 0;
}

function PerMonth({ gc, term, rate }: { gc: string; term: PlanTerm; rate: number }) {
  const t = useTranslations('billing');
  const value = toNumber(gc);
  if (rate <= 0 || value <= 0) return null;
  return (
    <span className={billing.sub}>
      {t('perMonthShort', { amount: value / rate / TERM_MONTHS[term] })}
    </span>
  );
}

type PriceCells = Record<PlanKind, Record<PlanTerm, string>>;

const cellsFrom = (get: (kind: PlanKind, term: PlanTerm) => number | null): PriceCells =>
  Object.fromEntries(
    PLAN_KINDS.map((kind) => [
      kind,
      Object.fromEntries(PLAN_TERMS.map((term) => [term, String(get(kind, term) ?? '')])),
    ]),
  ) as PriceCells;

function PriceTable({
  cells,
  onChange,
  placeholders,
  rate,
}: {
  cells: PriceCells;
  onChange: (kind: PlanKind, term: PlanTerm, value: string) => void;
  /** У города — значения страны: пустая ячейка наследует их. */
  placeholders?: Record<PlanKind, Record<PlanTerm, number>>;
  rate: number;
}) {
  const t = useTranslations('billing');
  const ta = useTranslations('auth');
  return (
    <div className={`${billing.grid} ${billing.prices}`}>
      <div className={billing.gridHead}>{t('colKind')}</div>
      {PLAN_TERMS.map((term) => (
        <div className={billing.gridHead} key={term}>
          {t(TERM_LABEL[term])}
        </div>
      ))}
      {EDITABLE_KINDS.map((kind) => (
        <div className={billing.rowGroup} key={kind}>
          <div className={billing.kind}>{ta(KIND_LABEL[kind])}</div>
          {PLAN_TERMS.map((term) => (
            <div className={billing.field} key={term}>
              <span className={billing.cellLabel}>{t(TERM_LABEL[term])}</span>
              <input
                className={billing.input}
                inputMode="numeric"
                aria-label={`${ta(KIND_LABEL[kind])} — ${t(TERM_LABEL[term])}`}
                placeholder={placeholders ? String(placeholders[kind][term]) : undefined}
                value={cells[kind][term]}
                onChange={(event) => onChange(kind, term, event.target.value)}
              />
              <PerMonth
                gc={cells[kind][term] || String(placeholders?.[kind][term] ?? '')}
                term={term}
                rate={rate}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Card({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>{title}</h3>
      <p className={styles.cardLead}>{lead}</p>
      {children}
    </section>
  );
}

function Notices({
  saved,
  invalid,
  failed,
}: {
  saved: boolean;
  invalid: boolean;
  failed: boolean;
}) {
  const t = useTranslations('billing');
  return (
    <>
      {saved ? <p className={`${billing.notice} ${billing.noticeOk}`}>{t('savedScope')}</p> : null}
      {invalid ? (
        <p className={`${billing.notice} ${billing.noticeError}`}>{t('invalidScope')}</p>
      ) : null}
      {failed ? (
        <p className={`${billing.notice} ${billing.noticeError}`}>{t('saveFailed')}</p>
      ) : null}
    </>
  );
}

/** Монетизация страны: цены размещения, ТОП анкет, ТОП агентств. Пустых значений нет. */
export function CountryMonetization({ countryId }: { countryId: string }) {
  const t = useTranslations('billing');
  const data = useQuery({
    queryKey: queryKeys.countryMonetization(countryId),
    queryFn: () => fetchCountryMonetization(countryId),
  });

  if (data.isError) return <p className={billing.empty}>{t('loadFailed')}</p>;
  if (!data.data) return <p className={billing.empty}>{t('loading')}</p>;
  return <CountryForm key={data.dataUpdatedAt} countryId={countryId} initial={data.data} />;
}

function CountryForm({
  countryId,
  initial,
}: {
  countryId: string;
  initial: CountryMonetizationData;
}) {
  const t = useTranslations('billing');
  const queryClient = useQueryClient();
  const rate = useGcPerEur();

  const [cells, setCells] = useState<PriceCells>(() =>
    cellsFrom((kind, term) => initial.prices[kind][term]),
  );
  const [top, setTop] = useState({
    weekGc: String(initial.top.weekGc),
    slots: String(initial.top.slots),
  });
  const [agencyTop, setAgencyTop] = useState({
    weekGc: String(initial.agencyTop.weekGc),
    slots: String(initial.agencyTop.slots),
  });
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: (input: CountryMonetizationData) => saveCountryMonetization(countryId, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.countryMonetization(countryId), saved);
      return queryClient.invalidateQueries({ queryKey: queryKeys.priceBook() });
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = {
      // Агентская строка сетки не редактируется — отправляем прежнюю.
      prices: Object.fromEntries(
        PLAN_KINDS.map((kind) => [
          kind,
          Object.fromEntries(
            PLAN_TERMS.map((term) => [
              term,
              kind === 'agency' ? initial.prices[kind][term] : toNumber(cells[kind][term]),
            ]),
          ),
        ]),
      ),
      top: { weekGc: toNumber(top.weekGc), slots: toNumber(top.slots) },
      agencyTop: { weekGc: toNumber(agencyTop.weekGc), slots: toNumber(agencyTop.slots) },
    };
    const parsed = countryMonetizationSchema.safeParse(candidate);
    setInvalid(!parsed.success);
    if (parsed.success) save.mutate(parsed.data);
  }

  const setCell = (kind: PlanKind, term: PlanTerm, value: string) =>
    setCells((prev) => ({ ...prev, [kind]: { ...prev[kind], [term]: value } }));

  return (
    <form onSubmit={onSubmit}>
      <Notices saved={save.isSuccess && !save.isPending} invalid={invalid} failed={save.isError} />

      <Card title={t('pricesSection')} lead={t('scopePricesHint')}>
        <PriceTable cells={cells} onChange={setCell} rate={rate} />
      </Card>

      <Card title={t('topSection')} lead={t('scopeTopHint')}>
        <TopFields value={top} onChange={setTop} idPrefix="top" rate={rate} />
      </Card>

      <Card title={t('agencyTopSection')} lead={t('scopeAgencyTopHint')}>
        <TopFields value={agencyTop} onChange={setAgencyTop} idPrefix="agency-top" rate={rate} />
      </Card>

      <Button type="submit" disabled={save.isPending}>
        {t('save')}
      </Button>
    </form>
  );
}

function TopFields({
  value,
  onChange,
  idPrefix,
  rate,
  placeholders,
}: {
  value: { weekGc: string; slots: string };
  onChange: (next: { weekGc: string; slots: string }) => void;
  idPrefix: string;
  rate: number;
  placeholders?: { weekGc: number; slots: number };
}) {
  const t = useTranslations('billing');
  const week = toNumber(value.weekGc || String(placeholders?.weekGc ?? ''));
  return (
    <div className={billing.currencyRow}>
      <div className={billing.field}>
        <label className={billing.label} htmlFor={`${idPrefix}-week`}>
          {t('topWeekLabelScope')}
        </label>
        <input
          className={billing.input}
          id={`${idPrefix}-week`}
          inputMode="numeric"
          placeholder={placeholders ? String(placeholders.weekGc) : undefined}
          value={value.weekGc}
          onChange={(event) => onChange({ ...value, weekGc: event.target.value })}
        />
        {rate > 0 && week > 0 ? (
          <span className={billing.sub}>{t('eurShort', { amount: week / rate })}</span>
        ) : null}
      </div>
      <div className={billing.field}>
        <label className={billing.label} htmlFor={`${idPrefix}-slots`}>
          {t('topSlotsLabelScope')}
        </label>
        <input
          className={billing.input}
          id={`${idPrefix}-slots`}
          inputMode="numeric"
          placeholder={placeholders ? String(placeholders.slots) : undefined}
          value={value.slots}
          onChange={(event) => onChange({ ...value, slots: event.target.value })}
        />
      </div>
    </div>
  );
}

/**
 * Монетизация города: цены размещения и ТОП анкет. Пустое поле — «как в
 * стране», подсказка показывает унаследованное значение. Тарифы и ТОП
 * агентств привязаны к стране компании, поэтому в городе их нет.
 */
export function CityMonetization({ cityId }: { cityId: string }) {
  const t = useTranslations('billing');
  const data = useQuery({
    queryKey: queryKeys.cityMonetization(cityId),
    queryFn: () => fetchCityMonetization(cityId),
  });

  if (data.isError) return <p className={billing.empty}>{t('loadFailed')}</p>;
  if (!data.data) return <p className={billing.empty}>{t('loading')}</p>;
  return <CityForm key={data.dataUpdatedAt} cityId={cityId} initial={data.data} />;
}

function CityForm({ cityId, initial }: { cityId: string; initial: CityMonetizationData }) {
  const t = useTranslations('billing');
  const queryClient = useQueryClient();
  const rate = useGcPerEur();

  const [cells, setCells] = useState<PriceCells>(() =>
    cellsFrom((kind, term) => initial.prices[kind]?.[term] ?? null),
  );
  const [top, setTop] = useState({
    weekGc: initial.top.weekGc === null ? '' : String(initial.top.weekGc),
    slots: initial.top.slots === null ? '' : String(initial.top.slots),
  });
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof cityMonetizationInputSchema.parse>) =>
      saveCityMonetization(cityId, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.cityMonetization(cityId), saved);
      return queryClient.invalidateQueries({ queryKey: queryKeys.priceBook() });
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = {
      prices: Object.fromEntries(
        PLAN_KINDS.map((kind) => [
          kind,
          Object.fromEntries(
            PLAN_TERMS.map((term) => [
              term,
              // Агентская строка в городе не используется — переопределений нет.
              kind === 'agency' ? null : toNullable(cells[kind][term]),
            ]),
          ),
        ]),
      ),
      top: { weekGc: toNullable(top.weekGc), slots: toNullable(top.slots) },
    };
    const parsed = cityMonetizationInputSchema.safeParse(candidate);
    setInvalid(!parsed.success);
    if (parsed.success) save.mutate(parsed.data);
  }

  const setCell = (kind: PlanKind, term: PlanTerm, value: string) =>
    setCells((prev) => ({ ...prev, [kind]: { ...prev[kind], [term]: value } }));

  return (
    <form onSubmit={onSubmit}>
      <Notices saved={save.isSuccess && !save.isPending} invalid={invalid} failed={save.isError} />

      <Card title={t('pricesSection')} lead={t('scopeCityHint')}>
        <PriceTable
          cells={cells}
          onChange={setCell}
          placeholders={initial.inherited.prices}
          rate={rate}
        />
      </Card>

      <Card title={t('topSection')} lead={t('scopeCityTopHint')}>
        <TopFields
          value={top}
          onChange={setTop}
          idPrefix="city-top"
          rate={rate}
          placeholders={initial.inherited.top}
        />
      </Card>

      <Button type="submit" disabled={save.isPending}>
        {t('save')}
      </Button>
    </form>
  );
}
