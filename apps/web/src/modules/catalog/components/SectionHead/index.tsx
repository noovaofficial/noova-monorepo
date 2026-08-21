import type { ReactNode } from 'react';
import { Link } from '@/shared/i18n/navigation';
import styles from './SectionHead.module.css';

type Props = {
  title: ReactNode;
  count?: string;
  moreHref?: string;
  moreLabel?: string;
  /** На главной секции — h2; при использовании как заголовка страницы — h1. */
  as?: 'h1' | 'h2';
};

export function SectionHead({ title, count, moreHref, moreLabel, as: Heading = 'h2' }: Props) {
  return (
    <div className={styles.head}>
      <Heading className={styles.title}>
        {title} {count ? <span className={styles.count}>{count}</span> : null}
      </Heading>
      {moreHref && moreLabel ? (
        <Link href={moreHref} className={styles.more}>
          {moreLabel}
        </Link>
      ) : null}
    </div>
  );
}
