import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/design-system/components/Button';
import { ProfileGrid } from '@/modules/catalog/components/ProfileGrid';
import { PromoSlider } from '@/modules/catalog/components/PromoSlider';
import { SectionHead } from '@/modules/catalog/components/SectionHead';
import { fetchCityName, fetchProfileCount, fetchProfiles, fetchPromo, safely } from '@/shared/api';
import { Link } from '@/shared/i18n/navigation';
import styles from './page.module.css';

// Главная перегенерируется раз в 5 минут: листинг меняется часто, но не настолько,
// чтобы рендерить его на каждый запрос.
export const revalidate = 300;

const DEFAULT_CITY = 'berlin';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const tm = await getTranslations({ locale, namespace: 'meta' });

  return {
    title: tm('homeTitle', { city: await fetchCityName(DEFAULT_CITY, { locale }) }),
    description: tm('homeDescription'),
    alternates: {
      canonical: `/${locale}`,
      // hreflang: каждый язык — отдельный документ, иначе они конкурируют в выдаче.
      languages: { de: '/de', en: '/en', ru: '/ru', 'x-default': '/de' },
    },
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const th = await getTranslations({ locale, namespace: 'home' });

  // Параллельно: пять независимых запросов, ждать их последовательно незачем.
  // revalidate передаём явно: Next берёт минимум из fetch-уровней, и без этого
  // дефолтные 60с молча переопределили бы объявленные на странице 300.
  // Локаль в кэш-ключ входит вместе с адресом: названия справочников
  // приходят из API переведёнными, и без неё ISR отдал бы чужой язык.
  const cache = { revalidate, locale };

  const emptyPage = { items: [], nextCursor: null, total: null };

  const [cityName, promo, escorts, escortCount, massage, massageCount] = await Promise.all([
    // Название города — из справочника, а не константой в коде: города
    // переводятся, и «Berlin» на русской странице читался бы как недоделка.
    fetchCityName(DEFAULT_CITY, cache),
    safely(fetchPromo(DEFAULT_CITY, cache), [], 'promo'),
    safely(
      fetchProfiles({ kind: 'escort', city: DEFAULT_CITY, limit: 20 }, cache),
      emptyPage,
      'escorts',
    ),
    safely(
      fetchProfileCount({ kind: 'escort', city: DEFAULT_CITY }, cache),
      { total: 0 },
      'escortCount',
    ),
    safely(
      fetchProfiles({ kind: 'massage', city: DEFAULT_CITY, limit: 10 }, cache),
      emptyPage,
      'massage',
    ),
    safely(
      fetchProfileCount({ kind: 'massage', city: DEFAULT_CITY }, cache),
      { total: 0 },
      'massageCount',
    ),
  ]);

  const nf = new Intl.NumberFormat(locale);

  return (
    <>
      <section className={styles.section}>
        <h1 className="visually-hidden">{th('escortSection', { city: cityName })}</h1>
        <PromoSlider slots={promo} />
      </section>

      <section className={styles.section}>
        <SectionHead
          title={th('escortSection', { city: cityName })}
          count={th('total', { count: nf.format(escortCount.total) })}
          moreHref={`/catalog/escort?city=${DEFAULT_CITY}`}
          moreLabel={th('showAll')}
        />
        <ProfileGrid profiles={escorts.items} locale={locale as Locale} />
        {escortCount.total > escorts.items.length ? (
          <div className={styles.showAll}>
            <Link href={`/catalog/escort?city=${DEFAULT_CITY}`}>
              <Button variant="secondary">
                {th('showAllProfiles', { count: nf.format(escortCount.total) })}
              </Button>
            </Link>
          </div>
        ) : null}
      </section>

      <section className={styles.section}>
        <SectionHead
          title={th('massageSection', { city: cityName })}
          count={th('total', { count: nf.format(massageCount.total) })}
          moreHref={`/catalog/massage?city=${DEFAULT_CITY}`}
          moreLabel={th('showAll')}
        />
        <ProfileGrid profiles={massage.items} locale={locale as Locale} />
        {massageCount.total > massage.items.length ? (
          <div className={styles.showAll}>
            <Link href={`/catalog/massage?city=${DEFAULT_CITY}`}>
              <Button variant="secondary">{th('showAllStudios')}</Button>
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}
