'use client';

import { LOCALES, type Translated } from '@noova/shared';
import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { LocationsError } from '@/modules/locations/api';
import { Link } from '@/shared/i18n/navigation';
import styles from '../Locations.module.css';

export type Translate = ReturnType<typeof useTranslations<'locations'>>;
/** undefined вместо void: при ошибке результата нет, но промис разрешается. */
export type Runner = <T>(action: () => Promise<T>, after?: () => void) => Promise<T | undefined>;

export const emptyNames = (): Translated =>
  Object.fromEntries(LOCALES.map((locale) => [locale, ''])) as Translated;

/**
 * Сообщение сервера показываем как есть: в нём объяснено, что именно не так —
 * занятый слуг, недостающий язык, дубль кода страны. Своя формулировка была бы
 * общее и бесполезнее.
 */
export function useRunner(t: Translate, refresh: () => void) {
  const [error, setError] = useState<string | null>(null);

  const run: Runner = (action, after) => {
    setError(null);
    return action()
      .then((result) => {
        refresh();
        after?.();
        return result;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof LocationsError && cause.message ? cause.message : t('failed'));
        return undefined;
      });
  };

  return { run, error };
}

/** Поля названия на все языки: неполный набор API не примет (N-35). */
export function NameFields({
  value,
  onChange,
  idPrefix,
}: {
  value: Translated;
  onChange: (next: Translated) => void;
  idPrefix: string;
}) {
  return (
    <div className={styles.formRow}>
      {LOCALES.map((locale) => (
        <div className={styles.field} key={locale}>
          <label className={styles.label} htmlFor={`${idPrefix}-${locale}`}>
            {locale.toUpperCase()}
          </label>
          <input
            className={styles.input}
            id={`${idPrefix}-${locale}`}
            value={value[locale]}
            onChange={(event) => onChange({ ...value, [locale]: event.target.value })}
            required
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Строка справочника: название, пояснение и две кнопки — «Просмотр» и
 * включение/отключение. Один и тот же вид на всех трёх уровнях, чтобы
 * страна, город и район не выглядели тремя разными интерфейсами.
 */
export function EntityRow({
  name,
  meta,
  isActive,
  href,
  onToggle,
  pending,
  t,
}: {
  name: string;
  meta: string;
  isActive: boolean;
  href?: string;
  onToggle: () => void;
  pending?: boolean;
  t: Translate;
}) {
  return (
    <div className={`${styles.row} ${isActive ? '' : styles.rowOff}`}>
      <div className={styles.rowMain}>
        <span className={styles.rowName}>{name}</span>
        <span className={styles.rowMeta}>{meta}</span>
      </div>
      <div className={styles.actions}>
        {href ? (
          // Ссылка, а не кнопка с router.push: «Просмотр» — переход, и он
          // должен открываться в новой вкладке средним щелчком, как всякая
          // навигация. Внешне не отличается — стиль общий с кнопками.
          <Link className={styles.linkButton} href={href}>
            {t('open')}
          </Link>
        ) : null}
        <Button variant="secondary" onClick={onToggle} disabled={pending}>
          {isActive ? t('disable') : t('enable')}
        </Button>
      </div>
    </div>
  );
}
