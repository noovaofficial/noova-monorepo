import type { ProfileSummary } from '@noova/shared';
import { Link } from '@/shared/i18n/navigation';
import styles from '../Moderation.module.css';

/**
 * Список анкет владельца — пользователя (`UserDetail`) или агентства
 * (`AgencyTariffDetail`). Одна разметка на обе карточки: они показывали
 * один и тот же список порознь, слово в слово, с разными переводами одних
 * и тех же подписей — здесь общий рендер, а подписи приходят уже
 * переведёнными от вызывающей страницы (у той и другой карточки свой
 * изолированный неймспейс словаря, общий компонент за перевод не отвечает).
 */
export function ProfileSummaryList({
  profiles,
  title,
  emptyText,
  statusLabel,
  verifiedLabel,
  featuredLabel,
  openLabel,
}: {
  profiles: ProfileSummary[];
  title: string;
  emptyText: string;
  statusLabel: (status: string) => string;
  verifiedLabel: string;
  featuredLabel: string;
  openLabel: string;
}) {
  return (
    <>
      <h2 className={styles.userSection}>{title}</h2>

      {profiles.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <div className={styles.staffList}>
          {profiles.map((profile) => (
            <div className={styles.staffRow} key={profile.id}>
              <div className={styles.staffMain}>
                <span className={styles.staffEmail}>{profile.displayName}</span>
                <span className={styles.staffMeta}>
                  {profile.cityName} · {statusLabel(profile.status)}
                  {profile.isVerified ? ` · ${verifiedLabel}` : ''}
                  {profile.isFeatured ? ` · ${featuredLabel}` : ''}
                </span>
              </div>
              <div className={styles.cardActions} style={{ padding: 0 }}>
                <Link className={styles.link} href={`/moderation/profiles/${profile.id}`}>
                  {openLabel}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
