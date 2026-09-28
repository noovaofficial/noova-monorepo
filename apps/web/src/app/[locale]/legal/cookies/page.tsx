import { LOCALES } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResetConsentButton } from '@/layout/CookieBanner/ResetConsentButton';
import styles from '@/modules/content/components/ContentPage/ContentPage.module.css';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cookiePolicy' });

  return {
    title: t('title'),
    description: t('lead'),
    alternates: {
      canonical: `/${locale}/legal/cookies`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/legal/cookies`])),
    },
  };
}

/**
 * Статическая страница.
 *
 * Общая часть (что такое cookie, срок хранения, как ими управлять,
 * правовое основание) — формулировки юриста, лишь слегка сокращённые под
 * заголовки этой страницы. Разделы про маркетинговые и сторонние cookie из
 * исходного текста сюда не попали: такой функциональности в продукте нет —
 * см. `documentation/planning/legal.md`, L-10.
 *
 * Постатейного списка кук с именами и сроками на странице нет — только
 * категории (обязательные / по согласию), как в исходном тексте юриста.
 */
export default async function CookiePolicyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'cookiePolicy' });

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lead}>{t('lead')}</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('whatTitle')}</h2>
        <p className={styles.text}>{t('whatText')}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('durationTitle')}</h2>
        <p className={styles.text}>{t('durationText')}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('requiredTitle')}</h2>
        <p className={styles.text}>{t('requiredText')}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('analyticsTitle')}</h2>
        <p className={styles.text}>{t('analyticsText')}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('consentCookieTitle')}</h2>
        <p className={styles.text}>{t('consentCookieText')}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('legalBasisTitle')}</h2>
        <p className={styles.text}>{t('legalBasisText')}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('controlTitle')}</h2>
        <p className={styles.text}>{t('controlText')}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('choiceTitle')}</h2>
        <p className={styles.text}>{t('choiceText')}</p>
        <ResetConsentButton label={t('resetButton')} />
      </section>
    </div>
  );
}
