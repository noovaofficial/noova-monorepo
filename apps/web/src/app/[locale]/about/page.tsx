import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import styles from '@/modules/content/components/ContentPage/ContentPage.module.css';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });

  return {
    title: t('title'),
    description: t('lead'),
    alternates: {
      canonical: `/${locale}/about`,
      languages: { de: '/de/about', en: '/en/about', ru: '/ru/about' },
    },
  };
}

/** Статическая страница: содержимое меняется редко, рендерить его на каждый
 *  запрос незачем. */
export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'about' });

  const sections = ['what', 'how', 'who', 'safety'] as const;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lead}>{t('lead')}</p>

      {sections.map((key) => (
        <section className={styles.section} key={key}>
          <h2 className={styles.sectionTitle}>{t(`${key}Title`)}</h2>
          <p className={styles.text}>{t(`${key}Text`)}</p>
        </section>
      ))}
    </div>
  );
}
