import type { ProfileStage, ProfileStatus } from '@noova/shared';
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

const STYLE_BY_STAGE: Record<ProfileStage, string | undefined> = {
  draft: styles.statusDraft,
  ready_for_review: styles.statusReady,
  in_review: styles.statusPending,
  ready_for_publication: styles.statusReady,
  published: styles.statusPublished,
  paused: styles.statusPaused,
  rejected: styles.statusRejected,
  banned: styles.statusBanned,
};

const KEY_BY_STAGE: Record<ProfileStage, string> = {
  draft: 'statusDraft',
  ready_for_review: 'stageReadyForReview',
  in_review: 'statusPending',
  ready_for_publication: 'stageReadyForPublication',
  published: 'statusPublished',
  paused: 'statusPaused',
  rejected: 'statusRejected',
  banned: 'statusBanned',
};

/** Бейдж стадии: то же, что статус, но различает «готова к проверке» и
 *  «готова к публикации» (см. `profileStage` в shared). */
export function ProfileStageBadge({ stage }: { stage: ProfileStage }) {
  const t = useTranslations('account');
  return (
    <span className={`${styles.status} ${STYLE_BY_STAGE[stage] ?? ''}`}>
      {t(KEY_BY_STAGE[stage])}
    </span>
  );
}
