'use client';

import type { Photo } from '@noova/shared';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { placeholderGradient } from '@/shared/format';
import styles from '../Gallery.module.css';
import { Lightbox } from '../Lightbox';

type Props = {
  photos: Photo[];
  alt: string;
  /** Сид для градиента-заглушки, когда фото ещё нет. */
  seed: string;
};

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export function Gallery({ photos, alt, seed }: Props) {
  const t = useTranslations('profile');
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const closeZoom = useCallback(() => setZoomed(false), []);
  const active = photos[activeIndex];
  const hasMany = photos.length > 1;

  // По кругу, а не с упором в край: на последнем снимке стрелка «вперёд»
  // не должна выглядеть сломанной.
  // useCallback здесь не ради скорости: функция уходит в Lightbox как
  // зависимость эффекта, и без стабильной ссылки он пересоздавал бы
  // обработчики клавиатуры на каждый рендер.
  const step = useCallback(
    (delta: number) => setActiveIndex((index) => (index + delta + photos.length) % photos.length),
    [photos.length],
  );

  // Стрелки клавиатуры слушаем на самой галерее, а не на документе: глобальный
  // обработчик перехватывал бы навигацию на других частях страницы.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!hasMany) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: контейнер-группа для клавиатурной навигации, не список
    <div
      className={styles.wrap}
      onKeyDown={onKeyDown}
      role="group"
      aria-roledescription="carousel"
      aria-label={alt}
    >
      <div
        className={styles.main}
        style={active ? undefined : { background: placeholderGradient(seed) }}
      >
        {active ? (
          <Image
            key={active.id}
            src={active.url}
            alt={alt}
            fill
            sizes="(max-width: 980px) 100vw, 600px"
            priority
            placeholder={active.blurDataUrl ? 'blur' : 'empty'}
            blurDataURL={active.blurDataUrl ?? undefined}
            style={{ objectFit: 'cover' }}
          />
        ) : null}

        {active ? (
          <button
            type="button"
            className={styles.mainButton}
            onClick={() => setZoomed(true)}
            aria-label={t('photoOpen')}
          />
        ) : null}

        {hasMany ? (
          <>
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowLeft}`}
              onClick={() => step(-1)}
              aria-label={t('photoPrev')}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowRight}`}
              onClick={() => step(1)}
              aria-label={t('photoNext')}
            >
              <ChevronRight />
            </button>
            <span className={styles.counter}>
              {t('photoCounter', { current: activeIndex + 1, total: photos.length })}
            </span>
          </>
        ) : null}
      </div>

      {hasMany ? (
        <div className={styles.thumbs}>
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              className={`${styles.thumb} ${index === activeIndex ? styles.thumbActive : ''}`}
              onClick={() => setActiveIndex(index)}
              aria-label={`${alt} — ${index + 1}`}
              aria-current={index === activeIndex}
            >
              <Image src={photo.url} alt="" fill sizes="84px" style={{ objectFit: 'cover' }} />
            </button>
          ))}
        </div>
      ) : null}

      {zoomed && active ? (
        <Lightbox photos={photos} index={activeIndex} alt={alt} onClose={closeZoom} onStep={step} />
      ) : null}
    </div>
  );
}
