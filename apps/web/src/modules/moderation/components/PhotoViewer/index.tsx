'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Overlay } from '@/overlays/Overlay';
import styles from './PhotoViewer.module.css';

export type ViewerPhoto = { url: string; caption?: string };

/**
 * Полноэкранный просмотр снимка для модератора.
 *
 * Свой, а не галерейный `Lightbox`: тот рисует через `next/image`, то есть
 * через оптимизатор, который кэширует картинки на диске сервера. Для
 * неодобренного фото это лишняя копия, для снимка документа — прямое
 * нарушение: он должен существовать только в хранилище.
 *
 * Escape и блокировку прокрутки берёт на себя `Overlay`; стрелки — здесь.
 */
export function PhotoViewer({
  photos,
  index,
  onClose,
  onStep,
}: {
  photos: ViewerPhoto[];
  index: number;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  const t = useTranslations('moderation');
  const photo = photos[index];
  const hasMany = photos.length > 1;

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
      <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={t('photoOpen')}>
        {/* Фон — настоящая кнопка, а не div с onClick: закрытие мышью не
            должно обходить правила доступности. Из табуляции убрана —
            для клавиатуры есть видимая кнопка и Escape. */}
        <button
          type="button"
          className={styles.backdrop}
          onClick={onClose}
          aria-label={t('photoClose')}
          tabIndex={-1}
        />

        <button type="button" className={styles.close} onClick={onClose}>
          {t('photoClose')}
        </button>

        {hasMany ? (
          <button
            type="button"
            className={`${styles.step} ${styles.prev}`}
            onClick={() => onStep(-1)}
            aria-label={t('photoPrev')}
          >
            ‹
          </button>
        ) : null}

        {/* Обычный img: ссылка живёт по сессии, и оптимизатор Next её
            всё равно не откроет. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.image} src={photo.url} alt="" />

        {hasMany ? (
          <button
            type="button"
            className={`${styles.step} ${styles.next}`}
            onClick={() => onStep(1)}
            aria-label={t('photoNext')}
          >
            ›
          </button>
        ) : null}

        {photo.caption ? <span className={styles.caption}>{photo.caption}</span> : null}
      </div>
    </Overlay>
  );
}
