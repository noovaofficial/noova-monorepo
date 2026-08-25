import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileGrid } from '@/modules/catalog/components/ProfileGrid';
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
    title: t(company.kind === 'salon' ? 'titleSalon' : 'titleAgency', { name: company.name }),
    description: company.description ?? undefined,
    alternates: { canonical: `/${locale}/company/${slug}` },
  };
}

export default async function CompanyPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const company = await load(slug, locale);
  if (!company) notFound();

  const t = await getTranslations({ locale, namespace: 'company' });

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <span className={styles.kind}>{t(company.kind === 'salon' ? 'salon' : 'agency')}</span>
        <h1 className={styles.name}>{company.name}</h1>

        {/* Адрес есть только у салона — это и есть отличие от агентства. */}
        {company.address ? <p className={styles.address}>{company.address}</p> : null}
        {company.description ? <p className={styles.description}>{company.description}</p> : null}

        {company.contacts.length > 0 ? (
          <ul className={styles.contacts}>
            {company.contacts.map((contact) => (
              <li className={styles.contact} key={`${contact.type}:${contact.value}`}>
                <span className={styles.contactType}>{t(`contact_${contact.type}`)}</span>
                {contact.value}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <h2 className={styles.listTitle}>{t('profiles', { count: company.profileCount })}</h2>
      {company.profiles.length > 0 ? (
        <ProfileGrid profiles={company.profiles} locale={locale} />
      ) : (
        <p className={styles.empty}>{t('noProfiles')}</p>
      )}
    </div>
  );
}
