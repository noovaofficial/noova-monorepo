'use client';

import type { PromoSlot } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { placeholderGradient } from '@/shared/format';
import { Link } from '@/shared/i18n/navigation';
import styles from './PromoSlider.module.css';

const SCROLL_STEP = 360;

export function PromoSlider({ slots }: { slots: PromoSlot[] }) {
  const t = useTranslations('card');
  const trackRef = useRef<HTMLDivElement>(null);

  if (slots.length === 0) return null;

  const scrollBy = (delta: number) => {
    trackRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.arrow} ${styles.left}`}
        onClick={() => scrollBy(-SCROLL_STEP)}
        aria-label="←"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <div className={styles.track} ref={trackRef}>
        {slots.map((slot) => (
          <Link
            key={slot.id}
            href={slot.href}
            className={styles.slide}
            style={
              slot.imageUrl
                ? { backgroundImage: `url(${slot.imageUrl})`, backgroundSize: 'cover' }
                : { background: placeholderGradient(slot.id) }
            }
          >
            <span className={styles.ad}>{t('ad')}</span>
            <div className={styles.scrim} />
            <div className={styles.label}>
              <div className={styles.title}>{slot.title}</div>
              {slot.subtitle ? <div className={styles.subtitle}>{slot.subtitle}</div> : null}
            </div>
          </Link>
        ))}
      </div>

      <button
        type="button"
        className={`${styles.arrow} ${styles.right}`}
        onClick={() => scrollBy(SCROLL_STEP)}
        aria-label="→"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}
