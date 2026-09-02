'use client';

import { moderationSubjectSchema } from '@noova/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchModerationLog, fetchStaff } from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { LoadMore } from '../LoadMore';
import styles from './ModerationLog.module.css';

const SUBJECT_LABEL: Record<string, string> = {
  photo: 'subjectPhoto',
  verification: 'subjectVerification',
  identity: 'subjectIdentity',
  profile: 'subjectProfile',
  comment: 'subjectComment',
  user: 'subjectUser',
};

export function ModerationLog() {
  const t = useTranslations('admin');
  const { user, status } = useSession();
  const router = useRouter();

  const [moderatorId, setModeratorId] = useState('');
  const [subjectType, setSubjectType] = useState('');
  const [decision, setDecision] = useState('');

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  // Список сотрудников нужен только админу — модератор всё равно видит
  // лишь свои решения, и выбирать ему не из кого.
  const { data: staff = [] } = useQuery({
    queryKey: queryKeys.staff(),
    queryFn: fetchStaff,
    enabled: status === 'authenticated' && isAdmin,
  });

  const filters = { moderatorId, subjectType, decision };
  const log = useInfiniteQuery({
    queryKey: queryKeys.moderationLog(filters),
    queryFn: ({ pageParam }) => fetchModerationLog(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: status === 'authenticated' && isStaff,
  });
  const entries = log.data ? log.data.pages.flatMap((page) => page.items) : null;
  const total = log.data?.pages[0]?.total ?? null;
  const isError = log.isError;

  if (status === 'loading') return <p className={styles.empty}>…</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isStaff) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  const formatted = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('logTitle')}</h1>
        <Link className={styles.back} href="/moderation">
          ← {t('backToQueue')}
        </Link>
      </div>

      <p className={styles.hint}>{isAdmin ? t('logHint') : t('logHintOwn')}</p>

      <div className={styles.filters}>
        {isAdmin ? (
          <select
            className={styles.select}
            value={moderatorId}
            onChange={(event) => setModeratorId(event.target.value)}
            aria-label={t('logAll')}
          >
            <option value="">{t('logAll')}</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.email}
              </option>
            ))}
          </select>
        ) : null}

        <select
          className={styles.select}
          value={subjectType}
          onChange={(event) => setSubjectType(event.target.value)}
          aria-label={t('logSubjectAll')}
        >
          <option value="">{t('logSubjectAll')}</option>
          {moderationSubjectSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(SUBJECT_LABEL[value] ?? 'subjectProfile')}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
          aria-label={t('logDecisionAll')}
        >
          <option value="">{t('logDecisionAll')}</option>
          <option value="approved">{t('decisionApproved')}</option>
          <option value="rejected">{t('decisionRejected')}</option>
        </select>
      </div>

      {isError ? <p className={styles.empty}>{t('logFailed')}</p> : null}

      {entries === null ? (
        <p className={styles.empty}>…</p>
      ) : entries.length === 0 ? (
        <p className={styles.empty}>{t('logEmpty')}</p>
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => {
            const subject = entry.subject;
            const row = (
              <>
                <div className={styles.main}>
                  <span className={styles.subject}>
                    {/* Предмет решения, а не его идентификатор: понять, чью
                        анкету тронули, нужно с первого взгляда. */}
                    {subject ? subject.title : t('subjectGone')}
                  </span>
                  <span className={styles.meta}>
                    {t(SUBJECT_LABEL[entry.subjectType] ?? 'subjectProfile')}
                    {subject?.cityName ? ` · ${subject.cityName}` : ''}
                    {subject?.accountEmail ? ` · ${subject.accountEmail}` : ''}
                  </span>
                  <span className={styles.meta}>
                    {entry.moderatorEmail} · {formatted(entry.createdAt)}
                  </span>
                  {entry.reason ? <span className={styles.reason}>{entry.reason}</span> : null}
                </div>
                <span
                  className={`${styles.badge} ${
                    entry.decision === 'rejected' ? styles.badgeRejected : styles.badgeApproved
                  }`}
                >
                  {t(entry.decision === 'approved' ? 'decisionApproved' : 'decisionRejected')}
                </span>
              </>
            );

            // Открывать нечего, если предмет удалён или это учётная запись:
            // мёртвая ссылка хуже её отсутствия.
            return subject?.profileId ? (
              <Link
                className={`${styles.row} ${styles.rowLink}`}
                key={entry.id}
                href={`/moderation/profiles/${subject.profileId}`}
              >
                {row}
              </Link>
            ) : (
              <div className={styles.row} key={entry.id}>
                {row}
              </div>
            );
          })}
          <LoadMore
            shown={entries.length}
            total={total}
            hasMore={log.hasNextPage}
            loading={log.isFetchingNextPage}
            onMore={() => void log.fetchNextPage()}
          />
        </div>
      )}
    </div>
  );
}
