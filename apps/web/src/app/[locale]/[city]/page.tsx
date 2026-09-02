import { DEFAULT_LOCALE, LOCALES, type Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/design-system/components/Button';
import { ProfileGrid } from '@/modules/catalog/components/ProfileGrid';
import { PromoSlider } from '@/modules/catalog/components/PromoSlider';
import { SectionHead } from '@/modules/catalog/components/SectionHead';
import { fetchProfileCount, fetchProfiles, fetchPromo, safely } from '@/shared/api';
import { requireCity } from '@/shared/city';
import { Link } from '@/shared/i18n/navigation';
import styles from './page.module.css';

// Главная перегенерируется раз в 5 минут: листинг меняется часто, но не настолько,
// чтобы рендерить его на каждый запрос.
export const revalidate = 300;

type Props = { params: Promise<{ locale: Locale; city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, city } = await params;
  const tm = await getTranslations({ locale, namespace: 'meta' });
  const found = await requireCity(locale, city);

  return {
    title: tm('homeTitle', { city: found.name }),
    description: tm('homeDescription'),
    alternates: {
      canonical: `/${locale}/${city}`,
      // hreflang: каждый язык — отдельный документ, иначе они конкурируют
      // в выдаче. Город в адрес входит, но между языками не меняется:
      // слуг города один на все языки, переводится только название.
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [l, `/${l}/${city}`])),
        'x-default': `/${DEFAULT_LOCALE}/${city}`,
      },
    },
  };
}

export default async function HomePage({ params }: Props) {
  const { locale, city } = await params;
  setRequestLocale(locale);

  // Неизвестный или отключённый город — 404. Подставлять вместо него первый
  // попавшийся нельзя: чужая ссылка молча показала бы другой город.
  const current = await requireCity(locale, city);

  const th = await getTranslations({ locale, namespace: 'home' });

  // Параллельно: пять независимых запросов, ждать их последовательно незачем.
  // revalidate передаём явно: Next берёт минимум из fetch-уровней, и без этого
  // дефолтные 60с молча переопределили бы объявленные на странице 300.
  // Локаль в кэш-ключ входит вместе с адресом: названия справочников
  // приходят из API переведёнными, и без неё ISR отдал бы чужой язык.
  const cache = { revalidate, locale };

  const emptyPage = { items: [], nextCursor: null, total: null };

  const cityName = current.name;
  const [promo, escorts, escortCount, massage, massageCount] = await Promise.all([
    safely(fetchPromo(city, cache), [], 'promo'),
    safely(fetchProfiles({ kind: 'escort', city, limit: 20 }, cache), emptyPage, 'escorts'),
    safely(fetchProfileCount({ kind: 'escort', city: city }, cache), { total: 0 }, 'escortCount'),
    safely(fetchProfiles({ kind: 'massage', city, limit: 10 }, cache), emptyPage, 'massage'),
    safely(fetchProfileCount({ kind: 'massage', city: city }, cache), { total: 0 }, 'massageCount'),
  ]);

  const nf = new Intl.NumberFormat(locale);

  return (
    <>
      <section className={styles.section}>
        <h1 className="visually-hidden">{th('escortSection', { city: cityName })}</h1>
        <PromoSlider slots={promo} />
      </section>

      <section className={styles.section}>
        {/* Город — в пути, а не в `?city=`: параметр каталог не читает (срез
            задаёт адрес), а путь без города уводит редиректом в первый
            активный город — с берлинской главной попадали в Амстердам. */}
        <SectionHead
          title={th('escortSection', { city: cityName })}
          count={th('total', { count: nf.format(escortCount.total) })}
          moreHref={`/${city}/catalog/escort`}
          moreLabel={th('showAll')}
        />
        <ProfileGrid profiles={escorts.items} locale={locale as Locale} />
        {escortCount.total > escorts.items.length ? (
          <div className={styles.showAll}>
            <Link href={`/${city}/catalog/escort`}>
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
          moreHref={`/${city}/catalog/massage`}
          moreLabel={th('showAll')}
        />
        <ProfileGrid profiles={massage.items} locale={locale as Locale} />
        {massageCount.total > massage.items.length ? (
          <div className={styles.showAll}>
            <Link href={`/${city}/catalog/massage`}>
              <Button variant="secondary">{th('showAllStudios')}</Button>
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}
