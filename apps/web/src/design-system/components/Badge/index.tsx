import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type BadgeProps = {
  variant?: 'verified' | 'featured' | 'neutral';
  children: ReactNode;
};

export function Badge({ variant = 'neutral', children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{children}</span>;
}
