import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type BadgeProps = {
  variant?: 'verified' | 'featured' | 'premium' | 'neutral' | 'company';
  children: ReactNode;
  /** Пояснение при наведении: что значок значит для посетителя. */
  hint?: string;
};

export function Badge({ variant = 'neutral', children, hint }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`} title={hint}>
      {children}
    </span>
  );
}

/** Класс бейджа для случаев, когда обёртка не span — например ссылка. */
export function badgeClass(variant: NonNullable<BadgeProps['variant']> = 'neutral') {
  return `${styles.badge} ${styles[variant]}`;
}
