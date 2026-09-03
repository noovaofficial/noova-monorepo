'use client';

import type { OwnPhoto } from '@noova/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { AccountError, deletePhoto, reorderPhotos, uploadPhoto } from '@/modules/account/api';
import styles from '../Account.module.css';

type Props = {
  profileId: string;
  photos: OwnPhoto[];
  onChange: (photos: OwnPhoto[]) => void;
};

/** Переводит ответ сервера в ключ словаря: тексты живут во фронте. */
function errorKey(error: unknown): string {
  if (!(error instanceof AccountError)) return 'photoFailed';
  if (error.status === 409) return 'photoLimit';
  if (error.status === 413) return 'photoTooLarge';
  if (error.status === 400) {
    return error.message.includes('размера') ? 'photoTooLarge' : 'photoBadFormat';
  }
  return 'photoFailed';
}

export function PhotoManager({ profileId, photos, onChange }: Props) {
  const t = useTranslations('account');
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Список фотографий живёт в редакторе анкеты, а не здесь: он часть той же
   * формы. Поэтому мутации, а не запросы — данные приходят пропсом, наружу
   * уходят через `onChange`. Флаг занятости и ключ ошибки даёт сам Query,
   * держать их отдельным `useState` больше не нужно.
   */
  const upload = useMutation({
    mutationFn: (file: File) => uploadPhoto(profileId, file),
    onSuccess: (uploaded) => onChange([...photos, uploaded]),
  });

  const remove = useMutation({
    mutationFn: (photoId: string) => deletePhoto(profileId, photoId),
    onSuccess: (_data, photoId) => onChange(photos.filter((p) => p.id !== photoId)),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderPhotos(profileId, ids),
    onSuccess: onChange,
    // Порядок показали сразу, до ответа: при отказе возвращаем прежний.
    onError: () => onChange(photos),
  });

  const busy = upload.isPending || remove.isPending || reorder.isPending;
  const error = upload.isError
    ? errorKey(upload.error)
    : remove.isError || reorder.isError
      ? 'photoFailed'
      : null;

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Сбрасываем input сразу: иначе повторный выбор того же файла
    // не вызовет событие change.
    event.target.value = '';
    if (file) upload.mutate(file);
  }

  const onDelete = (photoId: string) => remove.mutate(photoId);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;

    const next = [...photos];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);

    // Показываем новый порядок сразу, не дожидаясь сервера: перестановка
    // обратима и ошибка здесь ничего не разрушает.
    onChange(next);
    reorder.mutate(next.map((p) => p.id));
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('photos')}</h2>
      <span className={styles.hint}>{t('photosHint')}</span>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{t(error)}</p> : null}

      {photos.length === 0 ? (
        <p className={styles.hint}>{t('photoEmpty')}</p>
      ) : (
        <div className={styles.photoGrid}>
          {photos.map((photo, index) => (
            <div className={styles.photoCard} key={photo.id}>
              {/* Ссылка на неодобренное фото подписанная и живёт минуты,
                  поэтому next/image с его оптимизацией здесь не подходит. */}
              {/* biome-ignore lint/performance/noImgElement: подписанная ссылка живёт минуты, оптимизатор Next закэшировал бы её и отдавал битую */}
              <img src={photo.url} alt="" loading="lazy" />

              <span
                className={`${styles.photoBadge} ${
                  photo.rejectedReason
                    ? styles.photoBadgeRejected
                    : index === 0
                      ? styles.photoBadgeCover
                      : ''
                }`}
              >
                {photo.rejectedReason
                  ? t('photoRejected')
                  : photo.isApproved
                    ? index === 0
                      ? t('photoCover')
                      : String(index + 1)
                    : t('photoPending')}
              </span>

              <div className={styles.photoTools}>
                <button
                  type="button"
                  className={styles.photoTool}
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                  aria-label={t('photoMoveLeft')}
                >
                  ←
                </button>
                <button
                  type="button"
                  className={`${styles.photoTool} ${styles.photoToolDanger}`}
                  onClick={() => onDelete(photo.id)}
                  disabled={busy}
                >
                  {t('photoDelete')}
                </button>
                <button
                  type="button"
                  className={styles.photoTool}
                  onClick={() => move(index, 1)}
                  disabled={busy || index === photos.length - 1}
                  aria-label={t('photoMoveRight')}
                >
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <label className={styles.uploadLabel} htmlFor="photo-upload">
          {busy ? t('photoUploading') : t('photoUpload')}
        </label>
        <input
          ref={inputRef}
          className={styles.uploadInput}
          id="photo-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={onPick}
          disabled={busy || photos.length >= 20}
        />
      </div>

      <span className={styles.hint}>{t('photoModerationNote')}</span>
    </div>
  );
}
