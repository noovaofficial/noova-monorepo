import type { ProfileStatus } from '@noova/shared';
import { useTranslations } from 'next-intl';
import styles from '../Account.module.css';

const STYLE_BY_STATUS: Record<ProfileStatus, string | undefined> = {
  draft: styles.statusDraft,
  pending_verification: styles.statusPending,
  published: styles.statusPublished,
  paused: styles.statusPaused,
  rejected: styles.statusRejected,
  banned: styles.statusBanned,
};

const KEY_BY_STATUS: Record<ProfileStatus, string> = {
  draft: 'statusDraft',
  pending_verification: 'statusPending',
  published: 'statusPublished',
  paused: 'statusPaused',
  rejected: 'statusRejected',
  banned: 'statusBanned',
};

export function ProfileStatusBadge({ status }: { status: ProfileStatus }) {
  const t = useTranslations('account');
  return (
    <span className={`${styles.status} ${STYLE_BY_STATUS[status] ?? ''}`}>
      {t(KEY_BY_STATUS[status])}
    </span>
  );
}
