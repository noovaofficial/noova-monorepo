import type { AgencyCard as AgencyCardData } from '@noova/shared';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Badge } from '@/design-system/components/Badge';
import { placeholderGradient } from '@/shared/format';
import { Link } from '@/shared/i18n/navigation';
import styles from './AgencyCard.module.css';

type Props = { agency: AgencyCardData };

/**
 * Карточка агентства на главной (N-44) — горизонтальная, а не вертикальная,
 * как у анкеты: логотип слева, название и число анкет справа. У агентства
 * нет фото-портрета, под который стоило бы отводить всю высоту карточки.
 *
 * Вместо описания — число анкет в этом же срезе (город/страна): описание
 * агентство пишет о себе само и не всегда содержательно, а число анкет
 * говорит по делу и одинаково для всех карточек.
 */
export function AgencyCard({ agency }: Props) {
  const t = useTranslations('card');

  return (
    <Link href={`/company/${agency.slug}`} className={styles.card}>
      <div
        className={styles.logo}
        style={agency.logoUrl ? undefined : { background: placeholderGradient(agency.slug) }}
      >
        {agency.logoUrl ? (
          <Image src={agency.logoUrl} alt="" fill sizes="88px" style={{ objectFit: 'cover' }} />
        ) : null}
      </div>
      <div className={styles.body}>
        <div className={styles.nameRow}>
          <div className={styles.name}>{agency.name}</div>
          {agency.isFeatured ? <Badge variant="featured">★ {t('featured')}</Badge> : null}
        </div>
        <p className={styles.count}>{t('profileCount', { count: agency.profileCount })}</p>
      </div>
    </Link>
  );
}
