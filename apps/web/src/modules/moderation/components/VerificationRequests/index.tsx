'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { fetchVerifications } from '@/modules/moderation/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { LoadMore } from '../LoadMore';
import styles from '../Moderation.module.css';

const FILTERS = ['pending', 'approved', 'rejected'] as const;

/**
 * Заявки на верификацию личности (D-12). Список, а не карточки решения:
 * решение принимают, глядя на снимки, а снимки живут на своей странице —
 * так документ не оказывается на общем экране, мимо которого ходят.
 */
export function VerificationRequests() {
  const t = useTranslations('moderation');
  const format = useFormatter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');

  const list = useInfiniteQuery({
    queryKey: queryKeys.verifications(filter),
    queryFn: ({ pageParam }) => fetchVerifications(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = list.data ? list.data.pages.flatMap((page) => page.items) : null;
  const total = list.data?.pages[0]?.total ?? null;

  return (
    <>
      <p className={`${styles.notice} ${styles.noticeInfo}`}>{t('identityNote')}</p>

      <div className={styles.tabs}>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.tab} ${filter === value ? styles.tabActive : ''}`}
            onClick={() => setFilter(value)}
          >
            {t(`identityFilter_${value}`)}
          </button>
        ))}
      </div>

      {list.isError ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('loadFailed')}</p>
      ) : null}

      {items === null ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>{t('identityEmpty')}</p>
      ) : (
        <div className={styles.staffList}>
          {items.map((item) => (
            <div className={styles.staffRow} key={item.id}>
              <div className={styles.staffMain}>
                <span className={styles.staffEmail}>{item.profile.displayName}</span>
                <span className={styles.staffMeta}>
                  {item.profile.cityName} · {item.ownerEmail} ·{' '}
                  {format.dateTime(new Date(item.submittedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                {item.rejectionReason ? (
                  <span className={styles.reportBody}>{item.rejectionReason}</span>
                ) : null}
              </div>

              <div className={styles.cardActions} style={{ padding: 0 }}>
                {item.profile.isVerified ? (
                  <span className={styles.badge}>{t('identityBadge')}</span>
                ) : null}
                <Link className={styles.link} href={`/moderation/identity/${item.id}`}>
                  {t('identityOpen')}
                </Link>
              </div>
            </div>
          ))}

          <LoadMore
            shown={items.length}
            total={total}
            hasMore={list.hasNextPage}
            loading={list.isFetchingNextPage}
            onMore={() => void list.fetchNextPage()}
          />
        </div>
      )}
    </>
  );
}
