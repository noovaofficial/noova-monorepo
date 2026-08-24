import { LOCALES, type Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirectToSingleCity } from '@/shared/city';
import { Link } from '@/shared/i18n/navigation';
import styles from './cities.module.css';

export const revalidate = 300;

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cityPicker' });

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
        'x-default': '/de',
      },
    },
  };
}

/**
 * Адрес без города.
 *
 * Пока город один — редирект на него: страница выбора из одного пункта
 * бессмысленна. Появится второй — здесь сам собой окажется выбор города,
 * и отдельного поля «город по умолчанию» заводить не пришлось.
 */
export default async function CityPickerPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'cityPicker' });
  const cities = await redirectToSingleCity(locale);

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lead}>{t('description')}</p>

      {cities.length === 0 ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <ul className={styles.list}>
          {cities.map((city) => (
            <li key={city.slug}>
              <Link className={styles.city} href={`/${city.slug}`}>
                {city.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
