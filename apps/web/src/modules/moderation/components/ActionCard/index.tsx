import type { ReactNode } from 'react';
import styles from './ActionCard.module.css';

/**
 * Одна карточка — одно действие персонала (заблокировать, ТОП, монеты,
 * удалить). Раньше это были кнопки вперемешку, в разном порядке на разных
 * страницах и без единого вида; карточка — фиксированный каркас (иконка,
 * заголовок, статус, тело), который на карточке анкеты и карточке агентства
 * выглядит и читается одинаково.
 */
export function ActionCard({
  icon,
  title,
  status,
  tone = 'default',
  expanded = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** Короткая строка состояния под заголовком — например, срок в ТОПе. */
  status?: ReactNode;
  tone?: 'default' | 'danger';
  /** Карточка с открытой формой (причина, сумма) занимает всю ширину ряда. */
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        styles.card,
        tone === 'danger' ? styles.danger : '',
        expanded ? styles.expanded : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.header}>
        <span className={styles.icon}>{icon}</span>
        <div className={styles.headerText}>
          <span className={styles.title}>{title}</span>
          {status ? <span className={styles.status}>{status}</span> : null}
        </div>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
