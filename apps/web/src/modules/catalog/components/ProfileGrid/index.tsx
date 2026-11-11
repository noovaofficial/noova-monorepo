import type { Locale, ProfileCard as ProfileCardData } from '@noova/shared';
import { type EmptyCity, EmptyResults } from '../EmptyResults';
import { ProfileCard } from '../ProfileCard';
import styles from '../ProfileGrid.module.css';

type Props = {
  profiles: ProfileCardData[];
  locale: Locale;
  /** Для города без анкет — подсказка перейти на всю страну. */
  emptyCity?: EmptyCity;
};

export function ProfileGrid({ profiles, locale, emptyCity }: Props) {
  if (profiles.length === 0) return <EmptyResults city={emptyCity} />;

  return (
    <div className={styles.grid}>
      {profiles.map((profile, index) => (
        <ProfileCard key={profile.id} profile={profile} locale={locale} priority={index < 5} />
      ))}
    </div>
  );
}
