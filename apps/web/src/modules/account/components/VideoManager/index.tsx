'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AccountError, deleteVideo, fetchVideoState, uploadVideo } from '@/modules/account/api';
import { useErrorText } from '@/shared/error-text';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';
import own from './VideoManager.module.css';

/** Переводит ответ сервера в ключ словаря: тексты живут во фронте. */
function errorKey(error: unknown): string {
  if (!(error instanceof AccountError)) return 'videoUploadFailed';
  if (error.status === 402) return 'videoNeedsSubscription';
  if (error.status === 409) return 'videoExists';
  if (error.status === 413) return 'videoTooLarge';
  if (error.status === 400) {
    return error.message.includes('длиннее') ? 'videoTooLong' : 'videoBadFormat';
  }
  return 'videoUploadFailed';
}

/**
 * Видео анкеты: одно, короткое и только при действующей подписке. Без
 * подписки загрузка закрыта, а уже одобренное видео скрыто с публичной
 * страницы — владелец видит его здесь с пояснением.
 *
 * В отличие от фото, состояние живёт в своём запросе, а не в форме анкеты:
 * после загрузки видео ещё обрабатывается, и его статус нужно опрашивать.
 */
export function VideoManager({ profileId }: { profileId: string }) {
  const t = useTranslations('account');
  const explain = useErrorText();
  const queryClient = useQueryClient();
  const key = queryKeys.ownVideo(profileId);

  const state = useQuery({
    queryKey: key,
    queryFn: () => fetchVideoState(profileId),
    // Пока идёт обработка, спрашиваем раз в несколько секунд; потом — нет.
    refetchInterval: (query) => (query.state.data?.video?.status === 'processing' ? 4000 : false),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadVideo(profileId, file),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (videoId: string) => deleteVideo(profileId, videoId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Сбрасываем input сразу: иначе повторный выбор того же файла
    // не вызовет событие change.
    event.target.value = '';
    if (file) upload.mutate(file);
  }

  if (!state.data) return null;
  const { video, hasSubscription } = state.data;
  const busy = upload.isPending || remove.isPending;
  const error = upload.isError
    ? errorKey(upload.error)
    : remove.isError
      ? 'videoDeleteFailed'
      : null;

  const subscribe = (
    <Link className={own.link} href="/account/subscription">
      {t('videoSubscribeLink')}
    </Link>
  );

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('video')}</h2>
      <span className={styles.hint}>{t('videoHint')}</span>

      {error ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>
          {error === 'videoUploadFailed' || error === 'videoDeleteFailed'
            ? explain(upload.error ?? remove.error, t(error))
            : t(error)}
        </p>
      ) : null}

      {video?.status === 'processing' ? (
        <div className={own.processing}>{t('videoProcessing')}</div>
      ) : null}

      {video?.status === 'failed' ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('videoProcessFailed')}</p>
      ) : null}

      {video?.status === 'ready' && video.url ? (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: пользовательский ролик без речи, субтитров у него нет */}
          <video
            className={own.player}
            src={video.url}
            poster={video.posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
          />
          {video.rejectedReason ? (
            <p className={`${styles.notice} ${styles.noticeError}`}>
              {t('videoRejected', { reason: video.rejectedReason })}
            </p>
          ) : !video.isApproved ? (
            <p className={`${styles.notice} ${styles.noticeWarn}`}>{t('videoPending')}</p>
          ) : !hasSubscription ? (
            <p className={`${styles.notice} ${styles.noticeWarn}`}>
              {t('videoHiddenNoSubscription')} {subscribe}
            </p>
          ) : null}
        </>
      ) : null}

      {video ? (
        <div className={own.status}>
          <button
            type="button"
            className={`${styles.photoTool} ${styles.photoToolDanger}`}
            onClick={() => remove.mutate(video.id)}
            disabled={busy}
          >
            {t('videoDelete')}
          </button>
        </div>
      ) : hasSubscription ? (
        <div>
          <label className={styles.uploadLabel} htmlFor="video-upload">
            {busy ? t('videoUploading') : t('videoUpload')}
          </label>
          <input
            className={styles.uploadInput}
            id="video-upload"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            onChange={onPick}
            disabled={busy}
          />
        </div>
      ) : (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>
          {t('videoNeedsSubscription')} {subscribe}
        </p>
      )}

      <span className={styles.hint}>{t('videoModerationNote')}</span>
    </div>
  );
}
