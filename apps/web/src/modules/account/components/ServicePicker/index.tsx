'use client';

import type { ProfileServiceInput, ServiceGroup } from '@noova/shared';
import { useLocale, useTranslations } from 'next-intl';
import { currencySymbol, minorFactor } from '@/shared/format';
import styles from '../Account.module.css';

type Props = {
  catalog: ServiceGroup[];
  selected: ProfileServiceInput[];
  onChange: (next: ProfileServiceInput[]) => void;
  /** Валюта страны анкеты (ISO 4217): доплата вводится в ней. */
  currency?: string;
};

/**
 * Выбор услуг из справочника. Свободного ввода нет намеренно: набранные руками
 * названия расходятся в написании, не переводятся и не годятся для фильтров.
 */
export function ServicePicker({ catalog, selected, onChange, currency = 'EUR' }: Props) {
  const t = useTranslations('account');
  const locale = useLocale();
  const factor = minorFactor(currency);
  const symbol = currencySymbol(currency, locale);

  const byKey = new Map(selected.map((s) => [s.key, s]));

  const toggle = (key: string) => {
    onChange(
      byKey.has(key)
        ? selected.filter((s) => s.key !== key)
        : [...selected, { key, isExtra: false }],
    );
  };

  const toggleExtra = (key: string) => {
    // Снятая доплата забирает с собой и цену: она без неё не имеет смысла.
    onChange(
      selected.map((s) =>
        s.key === key ? { ...s, isExtra: !s.isExtra, extraPriceCents: null } : s,
      ),
    );
  };

  const setPrice = (key: string, value: string) => {
    const normalized = value.replace(',', '.').trim();
    const cents =
      normalized === '' || Number.isNaN(Number(normalized))
        ? null
        : Math.max(0, Math.round(Number(normalized) * factor));
    onChange(selected.map((s) => (s.key === key ? { ...s, extraPriceCents: cents } : s)));
  };

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('servicesTitle')}</h2>
      <span className={styles.hint}>{t('servicesHint')}</span>

      {catalog.map((group) => (
        <div className={styles.serviceGroup} key={group.group}>
          <span className={styles.serviceGroupTitle}>{group.name}</span>

          <div className={styles.serviceGrid}>
            {group.services.map((service) => {
              const picked = byKey.get(service.key);
              return (
                <div
                  key={service.key}
                  className={`${styles.serviceRow} ${picked ? styles.serviceRowChecked : ''}`}
                >
                  <label className={styles.serviceLabel} htmlFor={`svc-${service.key}`}>
                    <input
                      id={`svc-${service.key}`}
                      type="checkbox"
                      checked={Boolean(picked)}
                      onChange={() => toggle(service.key)}
                    />
                    <span className={styles.serviceName}>{service.name}</span>
                  </label>

                  {picked?.isExtra ? (
                    <label className={styles.extraPrice}>
                      <span className="visually-hidden">
                        {t('extraPriceLabel', { service: service.name, currency: symbol })}
                      </span>
                      <input
                        className={styles.extraPriceInput}
                        inputMode="decimal"
                        placeholder={t('extraPricePlaceholder')}
                        value={
                          picked.extraPriceCents == null
                            ? ''
                            : String(picked.extraPriceCents / factor)
                        }
                        onChange={(event) => setPrice(service.key, event.target.value)}
                      />
                      <span className={styles.extraPriceCurrency}>{symbol}</span>
                    </label>
                  ) : null}

                  {picked ? (
                    <button
                      type="button"
                      className={`${styles.extraToggle} ${picked.isExtra ? styles.extraToggleOn : ''}`}
                      onClick={() => toggleExtra(service.key)}
                      aria-pressed={picked.isExtra}
                    >
                      {t('extraLabel')}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
