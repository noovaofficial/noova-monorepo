'use client';

import type { PriceSlotInput } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/design-system/components/Button';
import styles from '../Account.module.css';

/** Цены в форме — в евро, в контракте — в центах. Конвертируем на границе. */
const toEuro = (cents: number | null) => (cents === null ? '' : String(cents / 100));
const toCents = (euro: string) => {
  const value = Number(euro.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
};

const MAX_PRICE_ROWS = 8;

type Props = {
  prices: PriceSlotInput[];
  onChange: (next: PriceSlotInput[]) => void;
};

/** Строки прайса: длительность, цена у себя и на выезде. Общий у анкеты и
 *  у компании — прайс агентства копируется в новые анкеты, форма одна. */
export function PriceSlotsEditor({ prices, onChange }: Props) {
  const t = useTranslations('account');

  const update = (index: number, patch: Partial<PriceSlotInput>) =>
    onChange(prices.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <>
      {prices.map((price, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: строки тарифов не переупорядочиваются
        <div className={styles.priceRow} key={index}>
          <div className={styles.field}>
            <span className={styles.label}>{t('duration')}</span>
            <input
              className={styles.input}
              type="number"
              min={15}
              max={1440}
              value={price.durationMinutes}
              onChange={(e) => update(index, { durationMinutes: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('incall')}</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={toEuro(price.incallCents)}
              onChange={(e) => update(index, { incallCents: toCents(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('outcall')}</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={toEuro(price.outcallCents)}
              onChange={(e) => update(index, { outcallCents: toCents(e.target.value) })}
            />
          </div>
          <button
            type="button"
            className={styles.remove}
            onClick={() => onChange(prices.filter((_, i) => i !== index))}
          >
            {t('removePrice')}
          </button>
        </div>
      ))}

      {prices.length < MAX_PRICE_ROWS ? (
        <Button
          variant="secondary"
          onClick={() =>
            onChange([...prices, { durationMinutes: 60, incallCents: null, outcallCents: null }])
          }
        >
          {t('addPrice')}
        </Button>
      ) : null}
    </>
  );
}
