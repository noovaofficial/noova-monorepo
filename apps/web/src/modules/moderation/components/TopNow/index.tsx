'use client';

import type { TopNowAgency, TopNowProfile } from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchTopNow } from '@/modules/moderation/api';
import { topExpiry } from '@/modules/moderation/top-expiry';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './TopNow.module.css';

/**
 * «Сейчас в ТОПе» — только для админа: кто занимает места прямо сейчас,
 * агентства и анкеты (индивидуалки, анкеты агентств, салоны), и когда
 * размещение кончается. Карточки узкие, с фото, клик ведёт в админский
 * просмотр анкеты или агентства — тот же, что из списков «Агентства»,
 * «Индивидуалки» и «Массажные салоны».
 */
export function TopNow() {
  const t = useTranslations('auth');
  const { user, status } = useSession();
  const router = useRouter();
  const isAdmin = user?.role === 'admin';

  const query = useQuery({
    queryKey: queryKeys.topNow(),
    queryFn: fetchTopNow,
    enabled: status === 'authenticated' && isAdmin,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;
  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }
  if (!isAdmin) return <p className={styles.empty}>{t('topNowOnlyAdmins')}</p>;
  if (query.isError) return <p className={styles.empty}>{t('topNowLoadFailed')}</p>;
  if (!query.data) return <p className={styles.empty}>{t('loading')}</p>;

  const { agencies, profiles } = query.data;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('topNowTitle')}</h1>
      <p className={styles.lead}>{t('topNowLead')}</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t('topNowAgencies')} <span className={styles.count}>{agencies.length}</span>
        </h2>
        {agencies.length === 0 ? (
          <p className={styles.emptyInline}>{t('topNowEmpty')}</p>
        ) : (
          <div className={styles.grid}>
            {agencies.map((agency) => (
              <AgencyCard key={agency.companyId} agency={agency} />
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t('topNowProfiles')} <span className={styles.count}>{profiles.length}</span>
        </h2>
        {profiles.length === 0 ? (
          <p className={styles.emptyInline}>{t('topNowEmpty')}</p>
        ) : (
          <div className={styles.grid}>
            {profiles.map((profile) => (
              <ProfileCard key={profile.profileId} profile={profile} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Expiry({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations('auth');
  const format = useFormatter();
  const expiry = topExpiry(new Date(expiresAt));

  const text =
    expiry.kind === 'hours'
      ? t('topNowHoursLeft', { count: expiry.value })
      : expiry.kind === 'days'
        ? t('topNowDaysLeft', { count: expiry.value })
        : t('topNowUntil', {
            date: format.dateTime(expiry.date, { day: 'numeric', month: 'long', year: 'numeric' }),
          });

  return <span className={expiry.kind === 'date' ? styles.expiry : styles.expirySoon}>{text}</span>;
}

function ProfileCard({ profile }: { profile: TopNowProfile }) {
  const t = useTranslations('auth');
  const ownerLabel =
    profile.ownerKind === 'agency'
      ? t('topNowOwnerAgency', { name: profile.companyName ?? '' })
      : profile.ownerKind === 'salon'
        ? t('topNowOwnerSalon')
        : t('topNowOwnerIndividual');

  return (
    <Link href={`/moderation/profiles/${profile.profileId}`} className={styles.card}>
      <div className={styles.thumb}>
        {profile.coverUrl ? (
          // biome-ignore lint/performance/noImgElement: превью в админке, оптимизатор Next тут ни к чему
          <img src={profile.coverUrl} alt="" loading="lazy" />
        ) : (
          <span className={styles.noPhoto}>{t('topNowNoPhoto')}</span>
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.name}>{profile.displayName}</span>
        <span className={styles.meta}>{profile.city}</span>
        <span className={styles.meta}>{ownerLabel}</span>
        <Expiry expiresAt={profile.expiresAt} />
      </div>
    </Link>
  );
}

function AgencyCard({ agency }: { agency: TopNowAgency }) {
  const t = useTranslations('auth');
  return (
    <Link href={`/admin/companies/${agency.companyId}`} className={styles.card}>
      <div className={`${styles.thumb} ${styles.thumbLogo}`}>
        {agency.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: логотип в админке, оптимизатор Next тут ни к чему
          <img src={agency.logoUrl} alt="" loading="lazy" />
        ) : (
          <span className={styles.noPhoto}>{t('topNowNoLogo')}</span>
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.name}>{agency.name}</span>
        <span className={styles.meta}>{t('topNowPublished', { count: agency.profileCount })}</span>
        <Expiry expiresAt={agency.expiresAt} />
      </div>
    </Link>
  );
}
