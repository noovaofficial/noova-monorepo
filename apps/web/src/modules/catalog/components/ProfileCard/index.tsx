import type { Locale, ProfileCard as ProfileCardData } from '@noova/shared';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Badge } from '@/design-system/components/Badge';
import { Tag } from '@/design-system/components/Tag';
import { FavoriteButton } from '@/modules/favorites/components/FavoriteButton';
import { formatMoney, placeholderGradient } from '@/shared/format';
import { Link } from '@/shared/i18n/navigation';
import styles from './ProfileCard.module.css';

type Props = {
  profile: ProfileCardData;
  locale: Locale;
  /** Первые карточки грузим приоритетно — они попадают в LCP. */
  priority?: boolean;
  /**
   * Анкета снята с публикации. Карточка остаётся видимой, но перестаёт быть
   * ссылкой: вести на 404 хуже, чем показать, что анкеты больше нет.
   * Сердце при этом работает — иначе отметку было бы не снять.
   */
  unavailable?: boolean;
};

export function ProfileCard({ profile, locale, priority = false, unavailable = false }: Props) {
  const t = useTranslations('card');
  // Ключи услуг переводятся здесь: в БД лежит только ключ, иначе название
  // не показать на трёх языках.
  const price = formatMoney(profile.fromPrice, locale);

  const cardClass = unavailable ? `${styles.card} ${styles.muted}` : styles.card;

  // Снятая анкета не должна быть ссылкой, но должна остаться карточкой:
  // подменяем обёртку, а не всю разметку.
  const inner = (
    <>
      <div
        className={styles.photo}
        style={profile.coverPhoto ? undefined : { background: placeholderGradient(profile.id) }}
      >
        {profile.coverPhoto ? (
          <Image
            src={profile.coverPhoto.url}
            alt=""
            fill
            // Сетка даёт ~5 колонок на десктопе и 2 на мобиле — по этим числам
            // браузер выбирает нужный размер и не тянет лишние байты.
            sizes="(max-width: 560px) 50vw, (max-width: 1200px) 33vw, 240px"
            priority={priority}
            placeholder={profile.coverPhoto.blurDataUrl ? 'blur' : 'empty'}
            blurDataURL={profile.coverPhoto.blurDataUrl ?? undefined}
            style={{ objectFit: 'cover' }}
          />
        ) : null}

        {/* Бейджи собраны в один ряд слева: правый верхний угол занят сердцем. */}
        <div className={styles.top}>
          {profile.isFeatured ? <Badge variant="featured">★ {t('featured')}</Badge> : null}
          {profile.isOnline ? (
            <span className={styles.online}>
              <span className={styles.dot} />
              {t('online')}
            </span>
          ) : null}
        </div>

        <div className={styles.scrim} />

        <div className={styles.who}>
          <div className={styles.name}>
            {profile.displayName}
            {profile.age ? `, ${profile.age}` : ''}
          </div>
          <div className={styles.location}>
            {profile.city.name}
            {profile.district ? ` · ${profile.district}` : ''}
          </div>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.tags}>
          {profile.services.slice(0, 3).map((service) => (
            <Tag key={service.key}>{service.name}</Tag>
          ))}
        </div>
        <div className={styles.foot}>
          {profile.isVerified ? <Badge variant="verified">✓ {t('verified')}</Badge> : <span />}
          {price ? (
            <span className={styles.price}>
              {t('priceFrom', { price })}
              <small>{t('perHour')}</small>
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  return (
    // Обёртка нужна ради сердца: <button> внутри <a> — невалидная разметка,
    // поэтому кнопка лежит рядом со ссылкой и позиционируется поверх неё.
    <div className={styles.wrap}>
      <FavoriteButton profileId={profile.id} className={styles.favorite} />
      {unavailable ? (
        <div className={cardClass}>{inner}</div>
      ) : (
        <Link href={`/profile/${profile.slug}`} className={cardClass}>
          {inner}
        </Link>
      )}
    </div>
  );
}
