'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/design-system/components/Button';
import { fetchBlockedProfiles, unblockProfile } from '@/modules/moderation/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { LoadMore } from '../LoadMore';
import styles from '../Moderation.module.css';

/**
 * Заблокированные анкеты. Не вкладка очереди: очередь — то, что ждёт решения,
 * а здесь решения уже приняты, и смотрят сюда с другой целью — вспомнить,
 * за что заблокировали, и при необходимости снять.
 */
export function BlockedProfiles() {
  const t = useTranslations('moderation');
  const queryClient = useQueryClient();

  const list = useInfiniteQuery({
    queryKey: queryKeys.blockedProfiles(),
    queryFn: ({ pageParam }) => fetchBlockedProfiles(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const unblock = useMutation({
    mutationFn: (id: string) => unblockProfile(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.blockedProfiles() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.queueCount() });
    },
  });

  const items = list.data ? list.data.pages.flatMap((page) => page.items) : null;
  const total = list.data?.pages[0]?.total ?? null;

  if (list.isError) {
    return <p className={styles.empty}>{t('loadFailed')}</p>;
  }

  if (items === null) return <p className={styles.empty}>{t('loading')}</p>;

  if (items.length === 0) {
    return <p className={styles.empty}>{t('blockedProfilesEmpty')}</p>;
  }

  return (
    <>
      <p className={`${styles.notice} ${styles.noticeInfo}`}>{t('blockedProfilesNote')}</p>

      <div className={styles.staffList}>
        {items.map((item) => (
          <div className={styles.staffRow} key={item.id}>
            <div className={styles.staffMain}>
              <span className={styles.staffEmail}>{item.displayName}</span>
              <span className={styles.staffMeta}>
                {item.cityName} · {item.ownerEmail}
                {item.blockedAt ? ` · ${new Date(item.blockedAt).toLocaleDateString()}` : ''}
              </span>
              {/* Причина в списке: без неё снимать блокировку пришлось бы
                  вслепую. */}
              {item.reason ? <p className={styles.reportBody}>{item.reason}</p> : null}
              {/* Блокировка анкеты и учётной записи — разные меры; видеть их
                  вместе нужно, чтобы не принять одну за другую. */}
              {item.isOwnerBlocked ? (
                <span className={styles.cardMeta}>{t('ownerAlsoBlocked')}</span>
              ) : null}
            </div>

            <div className={styles.cardActions} style={{ padding: 0 }}>
              <Link className={styles.link} href={`/moderation/profiles/${item.id}`}>
                {t('openProfile')}
              </Link>
              <Button
                variant="secondary"
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(item.id)}
              >
                {t('unblockProfile')}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <LoadMore
        shown={items.length}
        total={total}
        hasMore={list.hasNextPage}
        loading={list.isFetchingNextPage}
        onMore={() => void list.fetchNextPage()}
      />
    </>
  );
}
