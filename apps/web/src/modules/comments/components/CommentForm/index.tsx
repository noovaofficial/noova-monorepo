'use client';

import { COMMENT_MAX_LENGTH } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { CommentError, createComment, fetchOwnComment } from '@/modules/comments/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Comments.module.css';

type Props = { slug: string };

const MIN_LENGTH = 10;

/**
 * Форма отзыва и собственный комментарий автора. Клиентская целиком: и то,
 * и другое зависит от того, кто смотрит, а страница анкеты кэшируется ISR —
 * попади это в серверную разметку, чужой комментарий уехал бы в общий кэш.
 */
export function CommentForm({ slug }: Props) {
  const t = useTranslations('comments');
  const { status, user } = useSession();
  const [body, setBody] = useState('');
  const queryClient = useQueryClient();

  const isClient = user?.role === 'client';

  const ownQuery = useQuery({
    queryKey: queryKeys.ownComment(slug),
    queryFn: () => fetchOwnComment(slug),
    enabled: status === 'authenticated' && isClient,
  });

  const send = useMutation({
    mutationFn: () => createComment(slug, { body: body.trim() }),
    onSuccess: (created) => {
      setBody('');
      // Кладём ответ прямо в кэш: перезапрашивать то, что сервер только что
      // вернул, — лишний круг, а отзыв должен появиться сразу.
      queryClient.setQueryData(queryKeys.ownComment(slug), created);
    },
  });

  // `undefined` — ещё не знаем, `null` — своего отзыва нет. Разница важна:
  // в первом случае форму показывать рано.
  const own = ownQuery.isPending ? undefined : (ownQuery.data ?? null);
  const pending = send.isPending;
  const sendStatus = send.error instanceof CommentError ? send.error.status : 0;
  const errorKey = !send.isError
    ? null
    : sendStatus === 409
      ? 'errorTooOften'
      : sendStatus === 403
        ? 'errorForbidden'
        : 'errorFailed';

  // Гостю показываем приглашение войти, а не молчим: иначе непонятно,
  // почему формы нет.
  if (status === 'anonymous') {
    return (
      <p className={styles.hint}>
        {t.rich('signInToComment', {
          link: (chunks) => <Link href={`/login?next=/profile/${slug}`}>{chunks}</Link>,
        })}
      </p>
    );
  }

  if (status === 'loading') return null;

  // Рекламодателю и персоналу комментировать нечего — API им откажет.
  if (!isClient) return null;

  if (!user?.isEmailVerified) {
    return <p className={`${styles.notice} ${styles.noticeWarn}`}>{t('verifyEmailFirst')}</p>;
  }

  // Свой комментарий уже есть — показываем его со статусом вместо формы:
  // без этого кажется, что отправка не сработала.
  if (own) {
    return (
      <div className={styles.form}>
        <p
          className={`${styles.notice} ${
            own.status === 'published'
              ? styles.noticeOk
              : own.status === 'pending'
                ? styles.noticeInfo
                : styles.noticeWarn
          }`}
        >
          {t(`status_${own.status}`)}
          {own.moderationNote ? `: ${own.moderationNote}` : ''}
        </p>
        <p className={styles.body}>{own.body}</p>
      </div>
    );
  }

  if (own === undefined) return null;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send.mutate();
  }

  const length = body.trim().length;

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <textarea
        className={styles.textarea}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t('placeholder')}
        maxLength={COMMENT_MAX_LENGTH}
        required
      />

      {errorKey ? <p className={`${styles.notice} ${styles.noticeError}`}>{t(errorKey)}</p> : null}

      <p className={styles.hint}>{t('premoderationHint')}</p>

      <div className={styles.formFoot}>
        <span className={styles.counter}>
          {length} / {COMMENT_MAX_LENGTH}
        </span>
        <Button type="submit" disabled={pending || length < MIN_LENGTH}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
