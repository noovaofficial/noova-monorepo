'use client';

import { LOCALES, type Translated } from '@noova/shared';
import type { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useErrorText } from '@/shared/error-text';
import { Link } from '@/shared/i18n/navigation';
import styles from '../Locations.module.css';

export type Translate = ReturnType<typeof useTranslations<'locations'>>;
/** undefined вместо void: при ошибке результата нет, но промис разрешается. */
export type Runner = <T>(action: () => Promise<T>, after?: () => void) => Promise<T | undefined>;

export const emptyNames = (): Translated =>
  Object.fromEntries(LOCALES.map((locale) => [locale, ''])) as Translated;

/**
 * Причина — по коду ответа сервера и на языке интерфейса: занятый слуг, дубль
 * кода страны, город с анкетами. Текст самого сервера по-русски и на экран не
 * попадает.
 */
export function useRunner(t: Translate, refresh: () => void) {
  const explain = useErrorText();
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
        setError(explain(cause, t('failed')));
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
  extra,
}: {
  name: string;
  meta: string;
  isActive: boolean;
  href?: string;
  onToggle: () => void;
  pending?: boolean;
  t: Translate;
  /** Доп. действие только у страны (флаг «по умолчанию») — город и район
   *  им не пользуются, поэтому проп, а не отдельная копия строки. */
  extra?: ReactNode;
}) {
  return (
    <div className={`${styles.row} ${isActive ? '' : styles.rowOff}`}>
      <div className={styles.rowMain}>
        <span className={styles.rowName}>{name}</span>
        <span className={styles.rowMeta}>{meta}</span>
      </div>
      <div className={styles.actions}>
        {extra}
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

export type TabDef = {
  key: string;
  label: string;
  badge?: string | number;
  /** Вкладка видна, но недоступна (с подсказкой `hint`). */
  disabled?: boolean;
  hint?: string;
};

/**
 * Вкладки страницы страны и города. Активная хранится в `?tab=`: так после
 * сохранения и перезагрузки остаёшься там же, а ссылкой можно поделиться.
 * Адрес правим через history, а не роутером — без повторной загрузки страницы.
 */
export function useTab(tabs: TabDef[]): [string, (key: string) => void] {
  const first = tabs[0]?.key ?? '';
  const [active, setActive] = useState(first);

  // Читаем адрес после монтирования: на сервере его нет, и расхождение
  // разметки сломало бы гидратацию.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (fromUrl && tabs.some((tab) => tab.key === fromUrl && !tab.disabled)) setActive(fromUrl);
  }, [tabs]);

  const select = (key: string) => {
    setActive(key);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    window.history.replaceState(null, '', url);
  };
  return [active, select];
}

export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabDef[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          disabled={tab.disabled}
          title={tab.disabled ? tab.hint : undefined}
          className={`${styles.tab} ${tab.key === active ? styles.tabActive : ''}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
          {tab.badge !== undefined ? <span className={styles.tabBadge}>{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
