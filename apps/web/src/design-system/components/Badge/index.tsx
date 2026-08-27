import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type BadgeProps = {
  variant?: 'verified' | 'featured' | 'neutral' | 'company';
  children: ReactNode;
};

export function Badge({ variant = 'neutral', children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{children}</span>;
}

/** Класс бейджа для случаев, когда обёртка не span — например ссылка. */
export function badgeClass(variant: NonNullable<BadgeProps['variant']> = 'neutral') {
  return `${styles.badge} ${styles[variant]}`;
}
