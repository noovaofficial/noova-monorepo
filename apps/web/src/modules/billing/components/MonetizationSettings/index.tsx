'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  AGENCY_INCLUDED_SEATS,
  GC_PER_EUR,
  grantedGc,
  PLAN_KINDS,
  PLAN_TERMS,
  type PlanKind,
  type PlanTerm,
  PRICE_BOOK,
  SEAT_PRICE,
  TOPUP_PACKS,
} from '@/modules/billing/pricing';
import { useRouter } from '@/shared/i18n/navigation';
import styles from './MonetizationSettings.module.css';

/** Сколько месяцев в сроке — нужно, чтобы показать цену месяца. */
const MONTHS: Record<PlanTerm, number> = { m1: 1, m6: 6, m12: 12 };

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

type PriceState = Record<PlanKind, Record<PlanTerm, string>>;

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
  // Типы размещения подписаны так же, как при регистрации и в настройках:
  // это один и тот же выбор, и синонимы читались бы как разные тарифы.
  const ta = useTranslations('auth');
  const { user, status } = useSession();
  const router = useRouter();

  const [rate, setRate] = useState(String(GC_PER_EUR));
  const [tiers, setTiers] = useState(
    TOPUP_PACKS.map((pack) => ({
      eur: String(pack.eur),
      bonus: String(Math.round(pack.bonus * 100)),
    })),
  );
  const [prices, setPrices] = useState<PriceState>(
    () =>
      Object.fromEntries(
        PLAN_KINDS.map((kind) => [
          kind,
          Object.fromEntries(PLAN_TERMS.map((term) => [term, String(PRICE_BOOK[kind][term])])),
        ]),
      ) as PriceState,
  );
  const [seats, setSeats] = useState<Record<PlanTerm, string>>(
    () =>
      Object.fromEntries(PLAN_TERMS.map((term) => [term, String(SEAT_PRICE[term])])) as Record<
        PlanTerm,
        string
      >,
  );

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (user?.role !== 'admin') return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  const gcPerEur = num(rate);

  /** €-цена месяца для срока: цена в GC → евро по курсу → делим на месяцы. */
  const monthlyEur = (gc: string, term: PlanTerm): string => {
    if (gcPerEur <= 0) return '—';
    return t('perMonthShort', { amount: num(gc) / gcPerEur / MONTHS[term] });
  };

  const setPrice = (kind: PlanKind, term: PlanTerm, value: string) =>
    setPrices((prev) => ({ ...prev, [kind]: { ...prev[kind], [term]: value } }));

  const setTier = (index: number, field: 'eur' | 'bonus', value: string) =>
    setTiers((prev) => prev.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)));

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('monetizationTitle')}</h1>
        {/* Кнопка на месте и выключена, а не спрятана: экран проверяют целиком,
            и «где сохранение?» — первый вопрос, если её нет. */}
        <Button disabled>{t('save')}</Button>
      </div>
      <p className={styles.lead}>{t('monetizationLead')}</p>
      <p className={styles.notice}>{t('monetizationStub')}</p>

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
              value={rate}
              onChange={(event) => setRate(event.target.value)}
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

          {tiers.map((tier, index) => {
            const eur = num(tier.eur);
            const granted = grantedGc(eur, num(tier.bonus) / 100, gcPerEur);
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
                    value={prices[kind][term]}
                    onChange={(event) => setPrice(kind, term, event.target.value)}
                  />
                  <span className={styles.sub}>{monthlyEur(prices[kind][term], term)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('seatsSection')}</h2>
        <p className={styles.hint}>{t('seatsHint', { count: AGENCY_INCLUDED_SEATS })}</p>

        <div className={`${styles.grid} ${styles.seats}`}>
          {PLAN_TERMS.map((term) => (
            <div className={styles.gridHead} key={term}>
              {t(TERM_LABEL[term])}
            </div>
          ))}

          {PLAN_TERMS.map((term) => (
            <div className={styles.field} key={term}>
              <span className={styles.cellLabel}>{t(TERM_LABEL[term])}</span>
              <input
                className={styles.input}
                inputMode="numeric"
                aria-label={`${t('colSeat')} — ${t(TERM_LABEL[term])}`}
                value={seats[term]}
                onChange={(event) => setSeats((prev) => ({ ...prev, [term]: event.target.value }))}
              />
              <span className={styles.sub}>{monthlyEur(seats[term], term)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
