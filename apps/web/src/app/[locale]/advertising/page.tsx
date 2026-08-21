import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import styles from '@/modules/content/components/ContentPage/ContentPage.module.css';
import { Link } from '@/shared/i18n/navigation';

type Props = { params: Promise<{ locale: string }> };

/**
 * Тарифы размещения. Числа держим здесь, а не в словарях: цена одна на все
 * языки, и три копии в трёх файлах однажды разойдутся — в одном из них
 * останется старая.
 */
const PLANS = [
  { key: 'individual', price: 10 },
  { key: 'salon', price: 30 },
  { key: 'agency', price: 50 },
] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'advertising' });

  return {
    title: t('title'),
    description: t('lead'),
    alternates: {
      canonical: `/${locale}/advertising`,
      languages: { de: '/de/advertising', en: '/en/advertising', ru: '/ru/advertising' },
    },
  };
}

export default async function AdvertisingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'advertising' });

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lead}>{t('lead')}</p>

      <div className={styles.plans}>
        {PLANS.map((plan) => (
          <div className={styles.plan} key={plan.key}>
            <div className={styles.planName}>{t(`plan_${plan.key}`)}</div>
            <div className={styles.planPrice}>
              {t('price', { amount: plan.price })}
              <span className={styles.planPeriod}> {t('perMonth')}</span>
            </div>
          </div>
        ))}
      </div>

      <p className={styles.note}>{t('priceNote')}</p>

      <section className={styles.section} style={{ marginTop: 'var(--space8)' }}>
        <h2 className={styles.sectionTitle}>{t('includedTitle')}</h2>
        <ul className={styles.list}>
          <li>{t('includedPlacement')}</li>
          <li>{t('includedPhotos')}</li>
          <li>{t('includedContacts')}</li>
          <li>{t('includedStats')}</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('howTitle')}</h2>
        <p className={styles.text}>
          {t.rich('howText', {
            register: (chunks) => <Link href="/register">{chunks}</Link>,
            contact: (chunks) => <Link href="/contact">{chunks}</Link>,
          })}
        </p>
      </section>
    </div>
  );
}
