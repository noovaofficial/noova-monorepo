import type { ProfileSummary } from '@noova/shared';
import { placeholderGradient } from '@/shared/format';
import { Link } from '@/shared/i18n/navigation';
import styles from '../Moderation.module.css';

/**
 * Список анкет владельца — пользователя (`UserDetail`) или агентства
 * (`AgencyTariffDetail`). Одна разметка на обе карточки: они показывали
 * один и тот же список порознь, слово в слово, с разными переводами одних
 * и тех же подписей — здесь общий рендер, а подписи приходят уже
 * переведёнными от вызывающей страницы (у той и другой карточки свой
 * изолированный неймспейс словаря, общий компонент за перевод не отвечает).
 *
 * `layout="cards"` — фотосетка вместо строки текста: у агентства анкет может
 * быть много, и с фото их проще узнать глазом, чем по одному имени. Весь
 * блок карточки — ссылка (клик открывает анкету), отдельного `openLabel`
 * тут нет. У пользователя (всегда `layout="list"`, по умолчанию) фото не
 * запрашивается вовсе — `coverPhotoUrl` для него не приходит.
 */
export function ProfileSummaryList({
  profiles,
  title,
  emptyText,
  statusLabel,
  verifiedLabel,
  featuredLabel,
  openLabel,
  layout = 'list',
}: {
  profiles: ProfileSummary[];
  title: string;
  emptyText: string;
  statusLabel: (status: string) => string;
  verifiedLabel: string;
  featuredLabel: string;
  openLabel: string;
  layout?: 'list' | 'cards';
}) {
  return (
    <>
      <h2 className={styles.userSection}>{title}</h2>

      {profiles.length === 0 ? (
        <p className={`${styles.empty} ${styles.summaryList}`}>{emptyText}</p>
      ) : layout === 'cards' ? (
        <div className={`${styles.profileCardGrid} ${styles.summaryList}`}>
          {profiles.map((profile) => (
            <Link
              className={styles.profileCardLink}
              href={`/moderation/profiles/${profile.id}`}
              key={profile.id}
            >
              <div
                className={styles.profileCardThumb}
                style={
                  profile.coverPhotoUrl
                    ? undefined
                    : { background: placeholderGradient(profile.id) }
                }
              >
                {profile.coverPhotoUrl ? (
                  // biome-ignore lint/performance/noImgElement: сетка в админке, не публичная страница — оптимизатор Next здесь не нужен
                  <img src={profile.coverPhotoUrl} alt="" loading="lazy" />
                ) : null}
              </div>
              <div className={styles.profileCardBody}>
                <span className={styles.profileCardName}>{profile.displayName}</span>
                <span className={styles.profileCardMeta}>
                  {profile.cityName} · {statusLabel(profile.status)}
                  {profile.isVerified ? ` · ${verifiedLabel}` : ''}
                  {profile.isFeatured ? ` · ${featuredLabel}` : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className={`${styles.staffList} ${styles.summaryList}`}>
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
