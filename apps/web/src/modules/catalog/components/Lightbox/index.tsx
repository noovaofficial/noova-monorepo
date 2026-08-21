'use client';

import type { Photo } from '@noova/shared';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Overlay } from '@/overlays/Overlay';
import styles from '../Gallery.module.css';

type Props = {
  photos: Photo[];
  index: number;
  alt: string;
  onClose: () => void;
  onStep: (delta: number) => void;
};

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} />
  </svg>
);

export function Lightbox({ photos, index, alt, onClose, onStep }: Props) {
  const t = useTranslations('profile');
  const photo = photos[index];
  const hasMany = photos.length > 1;

  // Escape и блокировку прокрутки берёт на себя Overlay; здесь остаются
  // только стрелки — они специфичны для галереи.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') onStep(-1);
      else if (event.key === 'ArrowRight') onStep(1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onStep]);

  if (!photo) return null;

  return (
    <Overlay onClose={onClose}>
      <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={alt}>
        {/* Фон — настоящая кнопка, а не div с onClick: так закрытие мышью
            не требует обходить правила доступности. Из порядка табуляции
            она убрана, потому что для клавиатуры есть видимая кнопка «Закрыть»
            и Escape. */}
        <button
          type="button"
          className={styles.backdrop}
          onClick={onClose}
          aria-label={t('photoClose')}
          tabIndex={-1}
        />
        <button
          type="button"
          className={styles.lightboxClose}
          onClick={onClose}
          aria-label={t('photoClose')}
        >
          ×
        </button>

        {hasMany ? (
          <button
            type="button"
            className={styles.lightboxArrow}
            style={{ left: 'var(--space4)' }}
            onClick={() => onStep(-1)}
            aria-label={t('photoPrev')}
          >
            <Chevron dir="left" />
          </button>
        ) : null}

        <div className={styles.lightboxImage}>
          <Image
            key={photo.id}
            src={photo.fullUrl}
            alt={alt}
            fill
            sizes="100vw"
            priority
            placeholder={photo.blurDataUrl ? 'blur' : 'empty'}
            blurDataURL={photo.blurDataUrl ?? undefined}
            style={{ objectFit: 'contain' }}
          />
        </div>

        {hasMany ? (
          <>
            <button
              type="button"
              className={styles.lightboxArrow}
              style={{ right: 'var(--space4)' }}
              onClick={() => onStep(1)}
              aria-label={t('photoNext')}
            >
              <Chevron dir="right" />
            </button>
            <span className={styles.lightboxCounter}>
              {t('photoCounter', { current: index + 1, total: photos.length })}
            </span>
          </>
        ) : null}
      </div>
    </Overlay>
  );
}
