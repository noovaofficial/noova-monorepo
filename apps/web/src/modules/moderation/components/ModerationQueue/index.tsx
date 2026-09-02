'use client';

import type { QueueItem } from '@noova/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  approveComment,
  approvePhoto,
  approveVerification,
  fetchQueue,
  rejectComment,
  rejectPhoto,
  rejectVerification,
  resolveReport,
} from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys, queryPrefixes } from '@/shared/query-keys';
import { BlockedProfiles } from '../BlockedProfiles';
import { LoadMore } from '../LoadMore';
import styles from '../Moderation.module.css';
import { UserList } from '../UserList';

// Вкладки «пользователи» здесь больше нет: поиск человека переехал в свой
// раздел «Все пользователи». Заблокированные остались — это результат работы
// очереди, и смотрят на них сразу после решения.
const TABS = [
  'all',
  'report',
  'photo',
  'verification',
  'comment',
  'blockedProfiles',
  'blocked',
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  all: 'tabAll',
  photo: 'tabPhotos',
  verification: 'tabVerifications',
  comment: 'tabComments',
  report: 'tabReports',
  blockedProfiles: 'tabBlockedProfiles',
  blocked: 'tabBlockedUsers',
};

export function ModerationQueue() {
  const t = useTranslations('moderation');
  const { user, status } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('all');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';

  /**
   * Ключ включает вкладку — из-за этого быстрое переключение больше не
   * показывает чужие данные: ответ на прежний запрос ляжет в свой ключ,
   * а не в текущий экран. Раньше побеждал тот запрос, который вернулся
   * последним, и на вкладке «Фото» могли оказаться верификации.
   */
  // «Все» и «Пользователи» — не виды очереди: первое означает отсутствие
  // фильтра, второе — вообще другой экран.
  /**
   * Виды очереди перечислены явно, а не «всё кроме»: список вкладок растёт,
   * и вычитание рано или поздно пропустит новую вкладку в запрос к очереди.
   */
  const QUEUE_KINDS = ['photo', 'verification', 'comment', 'report'] as const;
  type QueueKind = (typeof QUEUE_KINDS)[number];
  const queueKind = (QUEUE_KINDS as readonly string[]).includes(tab)
    ? (tab as QueueKind)
    : undefined;
  const isQueueTab = tab === 'all' || queueKind !== undefined;

  // Страницы курсором: инвалидация группы перезапрашивает все загруженные,
  // и обработанная карточка исчезает, где бы она ни была.
  const queue = useInfiniteQuery({
    queryKey: queryKeys.queue(queueKind),
    queryFn: ({ pageParam }) => fetchQueue(queueKind, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: status === 'authenticated' && isStaff && isQueueTab,
  });

  const decision = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      setRejecting(null);
      setReason('');
      // Инвалидируем всю группу, а не текущий ключ: обработанная карточка
      // должна исчезнуть и со вкладки «Все», и счётчик в шапке — обновиться.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryPrefixes.queue() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.queueCount() }),
      ]);
    },
  });

  const items = queue.data ? queue.data.pages.flatMap((page) => page.items) : null;
  const total = queue.data?.pages[0]?.total ?? null;
  const busy = decision.isPending;
  const error = decision.isError ? 'actionFailed' : queue.isError ? 'loadFailed' : null;

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isStaff) return <p className={styles.empty}>{t('onlyStaff')}</p>;

  const decide = (action: () => Promise<unknown>) => decision.mutate(action);

  const key = (item: QueueItem) => `${item.kind}:${item.id}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
      </div>

      <div className={styles.tabs}>
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.tab} ${tab === value ? styles.tabActive : ''}`}
            onClick={() => setTab(value)}
          >
            {t(TAB_LABELS[value])}
          </button>
        ))}
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{t(error)}</p> : null}

      {tab === 'blockedProfiles' ? (
        <BlockedProfiles />
      ) : tab === 'blocked' ? (
        <UserList blockedOnly />
      ) : items === null ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <p>{t('empty')}</p>
          <p className={styles.hint}>{t('emptyHint')}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div className={styles.card} key={key(item)}>
              {item.kind === 'photo' ? (
                <div className={styles.cardPhoto}>
                  {/* Ссылка подписанная и живёт минуты — оптимизатор Next
                      закэшировал бы её и отдавал битую после истечения. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="" loading="lazy" />
                </div>
              ) : null}

              <div className={styles.cardBody}>
                <span className={styles.cardKind}>
                  {item.kind === 'photo'
                    ? t('photoOf')
                    : item.kind === 'verification'
                      ? t('verificationOf')
                      : item.kind === 'report'
                        ? t('reportOf')
                        : t(item.reports.length > 0 ? 'reportedCommentOf' : 'commentOf')}
                </span>
                <span className={styles.cardName}>{item.profile.displayName}</span>
                <span className={styles.cardMeta}>
                  {/* У комментария и жалобы вида анкеты нет: они относятся
                      к анкете целиком, а не к её типу. */}
                  {item.profile.cityName}
                  {item.kind === 'comment' || item.kind === 'report'
                    ? ''
                    : ` · ${item.profile.kind}`}
                </span>

                {item.kind === 'verification' ? (
                  <span className={styles.cardMeta}>
                    {t('photoCount', { count: item.photoCount })}
                  </span>
                ) : null}

                {item.kind === 'report' ? (
                  <>
                    {/* Срочное — не «важнее», а о возможном преступлении:
                        такая жалоба должна выделяться в списке сразу. */}
                    {item.isUrgent ? (
                      <span className={styles.urgentBadge}>{t('urgent')}</span>
                    ) : null}
                    <span className={styles.cardMeta}>{t(`reason_${item.reason}`)}</span>
                    <p className={styles.commentBody}>{item.details}</p>
                    <span className={styles.cardMeta}>
                      {item.reporterEmail
                        ? t('reporter', { email: item.reporterEmail })
                        : t('reporterAnonymous')}
                    </span>
                    {item.otherOpenReports > 0 ? (
                      <span className={styles.cardMeta}>
                        {t('otherReports', { count: item.otherOpenReports })}
                      </span>
                    ) : null}
                  </>
                ) : null}

                {item.kind === 'comment' ? (
                  <>
                    <p className={styles.commentBody}>{item.body}</p>
                    <span className={styles.cardMeta}>
                      {t('commentAuthor', { nickname: item.authorNickname })}
                    </span>
                    {/* Жалоба — единственный способ владелицы возразить:
                        модератор должен видеть её текст, а не только факт. */}
                    {item.reports.map((report) => (
                      <p className={styles.reportBody} key={report.id}>
                        {report.reason}
                      </p>
                    ))}
                  </>
                ) : null}

                {/* Публичная страница отдаёт 404, пока анкета не опубликована —
                    модератору нужен свой просмотр. */}
                <Link className={styles.link} href={`/moderation/profiles/${item.profile.id}`}>
                  {t('openProfile')}
                </Link>
              </div>

              {rejecting === key(item) ? (
                <div className={styles.reasonBox}>
                  <textarea
                    className={styles.textarea}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('reason')}
                    minLength={5}
                  />
                  <span className={styles.hint}>{t('reasonHint')}</span>
                  <div className={styles.cardActions} style={{ padding: 0 }}>
                    <Button
                      disabled={busy || reason.trim().length < 5}
                      onClick={() =>
                        decide(() =>
                          item.kind === 'photo'
                            ? rejectPhoto(item.id, reason.trim())
                            : item.kind === 'comment'
                              ? rejectComment(item.id, reason.trim())
                              : rejectVerification(item.id, reason.trim()),
                        )
                      }
                    >
                      {t('reject')}
                    </Button>
                    <Button variant="secondary" onClick={() => setRejecting(null)} disabled={busy}>
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.cardActions}>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      decide(() =>
                        item.kind === 'photo'
                          ? approvePhoto(item.id)
                          : item.kind === 'comment'
                            ? approveComment(item.id)
                            : item.kind === 'report'
                              ? resolveReport(item.id)
                              : approveVerification(item.id),
                      )
                    }
                  >
                    {/* У жалобы нет «одобрить»: она либо не подтвердилась,
                        либо анкету блокируют в её просмотре — отдельным
                        действием, чтобы блокировка не случалась мимоходом. */}
                    {t(item.kind === 'report' ? 'reportNoViolation' : 'approve')}
                  </Button>
                  {item.kind === 'report' ? null : (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setRejecting(key(item));
                        setReason('');
                      }}
                    >
                      {t('reject')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
          <LoadMore
            shown={items.length}
            total={total}
            hasMore={queue.hasNextPage}
            loading={queue.isFetchingNextPage}
            onMore={() => void queue.fetchNextPage()}
          />
        </div>
      )}
    </div>
  );
}
