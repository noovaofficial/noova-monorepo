import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileGrid } from '@/modules/catalog/components/ProfileGrid';
import { CompanyContactsCard } from '@/modules/contacts/components/CompanyContactsCard';
import { ApiError, fetchCompany } from '@/shared/api';
import styles from './page.module.css';

export const revalidate = 600;

type Props = { params: Promise<{ locale: Locale; slug: string }> };

/**
 * Страница салона или агентства (N-31).
 *
 * Без городского префикса: компания одна на каталог, а её анкеты могут быть
 * в разных городах. Тот же довод, что и у страницы анкеты — один объект,
 * один канонический адрес.
 */
async function load(slug: string, locale: Locale) {
  try {
    return await fetchCompany(slug, { revalidate, locale });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const company = await load(slug, locale);
  if (!company) return { title: 'Noova' };

  const t = await getTranslations({ locale, namespace: 'company' });
  return {
    title: t('titleAgency', { name: company.name }),
    description: company.description ?? undefined,
    alternates: { canonical: `/${locale}/company/${slug}` },
  };
}

const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 4 6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-6-4-9s1.5-6.4 4-9Z" />
  </svg>
);

export default async function CompanyPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const company = await load(slug, locale);
  if (!company) notFound();

  const t = await getTranslations({ locale, namespace: 'company' });
  const tCard = await getTranslations({ locale, namespace: 'card' });
  const tLang = await getTranslations({ locale, namespace: 'languageNames' });

  const lastSeenDate = company.lastSeenAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(company.lastSeenAt))
    : null;

  return (
    <div className={styles.wrap}>
      <header className={styles.headBlock}>
        {company.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: логотип уже готовый публичный webp фиксированного размера — оптимизировать нечего
          <img className={styles.logo} src={company.logoUrl} alt="" />
        ) : (
          <div className={styles.logoPlaceholder} aria-hidden="true" />
        )}

        <div className={styles.headInfo}>
          <span className={styles.kind}>{t('agency')}</span>
          <h1 className={styles.name}>{company.name}</h1>

          {company.isOnline ? (
            <span className={styles.online}>{tCard('online')}</span>
          ) : lastSeenDate ? (
            <span className={styles.lastSeen}>{t('lastSeenAt', { date: lastSeenDate })}</span>
          ) : null}

          {company.website ? (
            <a
              className={styles.website}
              href={company.website}
              target="_blank"
              rel="noreferrer nofollow"
            >
              <GlobeIcon />
              {company.website}
            </a>
          ) : null}

          {company.contactTypes.length > 0 ? (
            <div className={styles.contacts}>
              <CompanyContactsCard slug={company.slug} types={company.contactTypes} />
            </div>
          ) : null}
        </div>
      </header>

      {company.languages.length > 0 || company.payments.length > 0 || company.description ? (
        <section className={styles.infoBlock}>
          {company.languages.length > 0 ? (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{t('languages')}</span>
              <ul className={styles.chips}>
                {company.languages.map((code) => (
                  <li className={styles.chip} key={code}>
                    {tLang.has(code) ? tLang(code) : code}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {company.payments.length > 0 ? (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{t('payments')}</span>
              <ul className={styles.chips}>
                {company.payments.map((method) => (
                  <li className={styles.chip} key={method}>
                    {t(`payment_${method}`)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {company.description ? <p className={styles.description}>{company.description}</p> : null}
        </section>
      ) : null}

      <h2 className={styles.listTitle}>{t('profiles', { count: company.profileCount })}</h2>
      {company.profiles.length > 0 ? (
        <ProfileGrid profiles={company.profiles} locale={locale} />
      ) : (
        <p className={styles.empty}>{t('noProfiles')}</p>
      )}
    </div>
  );
}
