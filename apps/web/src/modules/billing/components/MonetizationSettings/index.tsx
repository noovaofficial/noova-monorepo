'use client';

import {
  type BillingConfigInput,
  billingConfigInputSchema,
  grantedGc,
  PLAN_KINDS,
  PLAN_TERMS,
  type PlanKind,
  type PlanTerm,
  type PriceBook,
  TERM_MONTHS,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { BillingError, fetchBillingConfig, saveBillingConfig } from '@/modules/billing/api';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './MonetizationSettings.module.css';

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

/** Поля держим строками: очищенный инпут — это пустая строка, а не ноль,
 *  и подставлять в него ноль на каждом стирании символа невозможно. */
const num = (value: string): number => Number(value.replace(',', '.')) || 0;

type FormState = {
  rate: string;
  tiers: { eur: string; bonus: string }[];
  prices: Record<PlanKind, Record<PlanTerm, string>>;
  agencyLimit: string;
  topWeek: string;
  topSlots: string;
  topShown: string;
};

function fromBook(book: PriceBook): FormState {
  return {
    rate: String(book.gcPerEur),
    tiers: book.topupTiers.map((tier) => ({
      eur: String(tier.eur),
      bonus: String(tier.bonusPercent),
    })),
    prices: Object.fromEntries(
      PLAN_KINDS.map((kind) => [
        kind,
        Object.fromEntries(PLAN_TERMS.map((term) => [term, String(book.prices[kind][term])])),
      ]),
    ) as FormState['prices'],
    agencyLimit: String(book.agencyProfileLimit),
    topWeek: String(book.top.weekGc),
    topSlots: String(book.top.slots),
    topShown: String(book.top.shown),
  };
}

function toInput(form: FormState): BillingConfigInput {
  return {
    gcPerEur: num(form.rate),
    topupTiers: form.tiers.map((tier) => ({ eur: num(tier.eur), bonusPercent: num(tier.bonus) })),
    prices: Object.fromEntries(
      PLAN_KINDS.map((kind) => [
        kind,
        Object.fromEntries(PLAN_TERMS.map((term) => [term, num(form.prices[kind][term])])),
      ]),
    ) as BillingConfigInput['prices'],
    agencyProfileLimit: num(form.agencyLimit),
    top: { weekGc: num(form.topWeek), slots: num(form.topSlots), shown: num(form.topShown) },
  };
}

/**
 * Настройки монетизации: курс, бонусная лестница и прайс размещения.
 *
 * По payments.md §5 это конфигурация (`PriceBook`, `TopupTier`), а не
 * константы в коде: курс, пороги и бонусы должны меняться без деплоя —
 * отсюда отдельный экран, а не правка файла.
 *
 * Только администратору: модератор разбирает очередь, а цены — решение
 * владельца продукта. Начисление за пополнение не хранится отдельным полем,
 * а считается из курса и бонуса — иначе здесь можно было бы сохранить
 * лестницу, где эти три числа не сходятся между собой.
 */
export function MonetizationSettings() {
  const t = useTranslations('billing');
  const { user, status } = useSession();
  const router = useRouter();

  const isAdmin = user?.role === 'admin';
  const config = useQuery({
    queryKey: queryKeys.billingConfig(),
    queryFn: fetchBillingConfig,
    enabled: status === 'authenticated' && isAdmin,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  if (config.isError) return <p className={styles.empty}>{t('loadFailed')}</p>;
  if (!config.data) return <p className={styles.empty}>{t('loading')}</p>;

  // Форма получает начальное состояние через ключ, а не через эффект:
  // повторная загрузка с сервера пересоздаёт её с новыми значениями, и
  // синхронизировать состояние с ответом руками не нужно.
  return <MonetizationForm key={config.dataUpdatedAt} initial={config.data} />;
}

function MonetizationForm({ initial }: { initial: PriceBook }) {
  const t = useTranslations('billing');
  // Типы размещения подписаны так же, как при регистрации и в настройках:
  // это один и тот же выбор, и синонимы читались бы как разные тарифы.
  const ta = useTranslations('auth');
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(() => fromBook(initial));
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: saveBillingConfig,
    onSuccess: async (book) => {
      queryClient.setQueryData(queryKeys.billingConfig(), book);
      // Кошелёк рекламодателя читает тот же прайс другим ключом.
      await queryClient.invalidateQueries({ queryKey: queryKeys.priceBook() });
    },
  });

  const gcPerEur = num(form.rate);

  /** €-цена месяца для срока: цена в GC → евро по курсу → делим на месяцы. */
  const monthlyEur = (gc: string, term: PlanTerm): string => {
    if (gcPerEur <= 0) return '—';
    return t('perMonthShort', { amount: num(gc) / gcPerEur / TERM_MONTHS[term] });
  };

  /** Во что обходится агентству одна анкета — единственный способ увидеть,
   *  осталась ли объёмная скидка при плоском тарифе. */
  const perProfileEur = (gc: string, term: PlanTerm): string => {
    const limit = num(form.agencyLimit);
    if (gcPerEur <= 0 || limit <= 0) return '—';
    return t('perProfileShort', { amount: num(gc) / gcPerEur / TERM_MONTHS[term] / limit });
  };

  /** €-эквивалент недели по курсу — чтобы цена ТОПа читалась рядом с тарифами. */
  const monthlyEurFlat = (gc: string): string =>
    gcPerEur <= 0 ? '—' : t('eurShort', { amount: num(gc) / gcPerEur });

  const setPrice = (kind: PlanKind, term: PlanTerm, value: string) =>
    setForm((prev) => ({
      ...prev,
      prices: { ...prev.prices, [kind]: { ...prev.prices[kind], [term]: value } },
    }));

  const setTier = (index: number, field: 'eur' | 'bonus', value: string) =>
    setForm((prev) => ({
      ...prev,
      tiers: prev.tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)),
    }));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Проверяем той же схемой, что и сервер: ошибка называется до запроса,
    // а не приходит обратно безликим 400.
    const parsed = billingConfigInputSchema.safeParse(toInput(form));
    setInvalid(!parsed.success);
    if (parsed.success) save.mutate(parsed.data);
  }

  const failed = save.isError && !(save.error instanceof BillingError && save.error.status === 400);
  const rejected = save.isError && !failed;

  return (
    <form className={styles.wrap} onSubmit={onSubmit}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('monetizationTitle')}</h1>
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
      </div>
      <p className={styles.lead}>{t('monetizationLead')}</p>

      {save.isSuccess && !save.isPending ? (
        <p className={`${styles.notice} ${styles.noticeOk}`}>{t('saved')}</p>
      ) : null}
      {invalid || rejected ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('invalidConfig')}</p>
      ) : null}
      {failed ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('saveFailed')}</p>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('currencySection')}</h2>
        <p className={styles.hint}>{t('currencyHint')}</p>

        <div className={styles.currencyRow}>
          <div className={styles.field}>
            <span className={styles.label}>{t('fieldName')}</span>
            <span className={styles.static}>GlowCoin</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('fieldTicker')}</span>
            <span className={styles.static}>{t('ticker')}</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="gc-rate">
              {t('fieldRate')}
            </label>
            <input
              className={styles.input}
              id="gc-rate"
              inputMode="decimal"
              value={form.rate}
              onChange={(event) => setForm((prev) => ({ ...prev, rate: event.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('tiersSection')}</h2>
        <p className={styles.hint}>{t('tiersHint')}</p>

        <div className={`${styles.grid} ${styles.tiers}`}>
          <div className={styles.gridHead}>{t('colTopup')}</div>
          <div className={styles.gridHead}>{t('colBonus')}</div>
          <div className={styles.gridHead}>{t('colGranted')}</div>
          <div className={styles.gridHead}>{t('colRate')}</div>

          {form.tiers.map((tier, index) => {
            const eur = num(tier.eur);
            const granted = grantedGc(eur, num(tier.bonus), gcPerEur);
            return (
              // Ключ по позиции: сумма порога — редактируемое поле, и на
              // полустёртом значении два порога совпадут.
              // biome-ignore lint/suspicious/noArrayIndexKey: строки лестницы не переставляются
              <div className={styles.rowGroup} key={index}>
                <div className={styles.field}>
                  <span className={styles.cellLabel}>{t('colTopup')}</span>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    aria-label={t('colTopup')}
                    value={tier.eur}
                    onChange={(event) => setTier(index, 'eur', event.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.cellLabel}>{t('colBonus')}</span>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    aria-label={t('colBonus')}
                    value={tier.bonus}
                    onChange={(event) => setTier(index, 'bonus', event.target.value)}
                  />
                </div>
                <div className={styles.computed}>
                  <span className={styles.cellLabel}>{t('colGranted')}</span>
                  {granted} {t('ticker')}
                </div>
                <div className={styles.computed}>
                  <span className={styles.cellLabel}>{t('colRate')}</span>
                  {eur > 0 ? t('gcPerEur', { rate: granted / eur }) : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('pricesSection')}</h2>
        <p className={styles.hint}>{t('pricesHint')}</p>

        <div className={`${styles.grid} ${styles.prices}`}>
          <div className={styles.gridHead}>{t('colKind')}</div>
          {PLAN_TERMS.map((term) => (
            <div className={styles.gridHead} key={term}>
              {t(TERM_LABEL[term])}
            </div>
          ))}

          {PLAN_KINDS.map((kind) => (
            <div className={styles.rowGroup} key={kind}>
              <div className={styles.kind}>{ta(KIND_LABEL[kind])}</div>
              {PLAN_TERMS.map((term) => (
                <div className={styles.field} key={term}>
                  <span className={styles.cellLabel}>{t(TERM_LABEL[term])}</span>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    aria-label={`${ta(KIND_LABEL[kind])} — ${t(TERM_LABEL[term])}`}
                    value={form.prices[kind][term]}
                    onChange={(event) => setPrice(kind, term, event.target.value)}
                  />
                  <span className={styles.sub}>
                    {monthlyEur(form.prices[kind][term], term)}
                    {kind === 'agency' ? (
                      <> · {perProfileEur(form.prices[kind][term], term)}</>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('agencySection')}</h2>
        <p className={styles.hint}>{t('agencyHint')}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="agency-limit">
            {t('agencyLimit')}
          </label>
          <input
            className={`${styles.input} ${styles.narrow}`}
            id="agency-limit"
            inputMode="numeric"
            value={form.agencyLimit}
            onChange={(event) => setForm((prev) => ({ ...prev, agencyLimit: event.target.value }))}
          />
        </div>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('topSection')}</h2>
        <p className={styles.hint}>{t('topHint')}</p>

        <div className={styles.currencyRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="top-week">
              {t('topWeekLabel')}
            </label>
            <input
              className={styles.input}
              id="top-week"
              inputMode="numeric"
              value={form.topWeek}
              onChange={(event) => setForm((prev) => ({ ...prev, topWeek: event.target.value }))}
            />
            <span className={styles.sub}>{monthlyEurFlat(form.topWeek)}</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="top-slots">
              {t('topSlotsLabel')}
            </label>
            <input
              className={styles.input}
              id="top-slots"
              inputMode="numeric"
              value={form.topSlots}
              onChange={(event) => setForm((prev) => ({ ...prev, topSlots: event.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="top-shown">
              {t('topShownLabel')}
            </label>
            <input
              className={styles.input}
              id="top-shown"
              inputMode="numeric"
              value={form.topShown}
              onChange={(event) => setForm((prev) => ({ ...prev, topShown: event.target.value }))}
            />
          </div>
        </div>
      </section>
    </form>
  );
}
