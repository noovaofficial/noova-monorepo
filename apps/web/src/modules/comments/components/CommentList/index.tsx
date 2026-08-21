import type { Locale, ProfileComment } from '@noova/shared';
import { getTranslations } from 'next-intl/server';
import { CommentActions } from '../CommentActions';
import styles from '../Comments.module.css';

type Props = {
  locale: Locale;
  comments: ProfileComment[];
};

/**
 * Опубликованные комментарии рисует сервер: это содержимое страницы, оно
 * должно попадать в индекс и читаться без JS. Всё, что зависит от
 * смотрящего — форма, свой неопубликованный комментарий, жалоба, — живёт
 * в клиентском `CommentActions`, иначе страница перестала бы кэшироваться.
 *
 * Тело выводится как текст: React экранирует его сам, а разметки в
 * комментариях нет и по контракту.
 */
export async function CommentList({ locale, comments }: Props) {
  const t = await getTranslations({ locale, namespace: 'comments' });
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });

  return (
    <>
      {comments.length === 0 ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <div className={styles.list}>
          {comments.map((comment) => (
            <article className={styles.item} key={comment.id}>
              <div className={styles.head}>
                <span className={styles.author}>{comment.authorNickname}</span>
                <time className={styles.date} dateTime={comment.createdAt}>
                  {formatter.format(new Date(comment.createdAt))}
                </time>
              </div>
              <p className={styles.body}>{comment.body}</p>
              <CommentActions commentId={comment.id} />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
