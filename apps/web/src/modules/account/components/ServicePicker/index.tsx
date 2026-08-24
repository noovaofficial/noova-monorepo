'use client';

import type { ProfileServiceInput, ServiceGroup } from '@noova/shared';
import { useTranslations } from 'next-intl';
import styles from '../Account.module.css';

type Props = {
  catalog: ServiceGroup[];
  selected: ProfileServiceInput[];
  onChange: (next: ProfileServiceInput[]) => void;
};

/**
 * Выбор услуг из справочника. Свободного ввода нет намеренно: набранные руками
 * названия расходятся в написании, не переводятся и не годятся для фильтров.
 */
export function ServicePicker({ catalog, selected, onChange }: Props) {
  const t = useTranslations('account');

  const byKey = new Map(selected.map((s) => [s.key, s]));

  const toggle = (key: string) => {
    onChange(
      byKey.has(key)
        ? selected.filter((s) => s.key !== key)
        : [...selected, { key, isExtra: false }],
    );
  };

  const toggleExtra = (key: string) => {
    onChange(selected.map((s) => (s.key === key ? { ...s, isExtra: !s.isExtra } : s)));
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
