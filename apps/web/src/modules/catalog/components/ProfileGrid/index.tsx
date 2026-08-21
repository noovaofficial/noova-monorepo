import type { Locale, ProfileCard as ProfileCardData } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { ProfileCard } from '../ProfileCard';
import styles from '../ProfileGrid.module.css';

type Props = {
  profiles: ProfileCardData[];
  locale: Locale;
};

export function ProfileGrid({ profiles, locale }: Props) {
  const t = useTranslations('home');

  if (profiles.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{t('empty')}</p>
        <p>{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {profiles.map((profile, index) => (
        <ProfileCard key={profile.id} profile={profile} locale={locale} priority={index < 5} />
      ))}
    </div>
  );
}
