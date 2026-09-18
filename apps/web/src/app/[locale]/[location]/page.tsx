import { DEFAULT_LOCALE, LOCALES, type Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/design-system/components/Button';
import { AgencyGrid } from '@/modules/catalog/components/AgencyGrid';
import { ProfileGrid } from '@/modules/catalog/components/ProfileGrid';
import { PromoSlider } from '@/modules/catalog/components/PromoSlider';
import { SectionHead } from '@/modules/catalog/components/SectionHead';
import {
  fetchAgencies,
  fetchProfileCount,
  fetchProfiles,
  fetchPromo,
  fetchTopProfiles,
  safely,
} from '@/shared/api';
import { requireLocation } from '@/shared/city';
import { Link } from '@/shared/i18n/navigation';
import { socialMeta } from '@/shared/metadata';
import styles from './page.module.css';

// Главная перегенерируется раз в 5 минут: листинг меняется часто, но не настолько,
// чтобы рендерить его на каждый запрос.
export const revalidate = 300;

// Один ряд, не больше — агентства не листаются, это витрина, а не каталог.
const AGENCY_LIMIT = 4;

type Props = { params: Promise<{ locale: Locale; location: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, location } = await params;
  const tm = await getTranslations({ locale, namespace: 'meta' });
  const resolved = await requireLocation(locale, location);
  // Канонический слуг — не то, что пришло в адресе: код страны нормализуем
  // в нижний регистр, иначе `/DE` и `/de` были бы двумя разными документами.
  const slug = resolved.type === 'city' ? resolved.city.slug : resolved.country.code.toLowerCase();
  const name = resolved.type === 'city' ? resolved.city.name : resolved.country.name;
  const title = tm('homeTitle', { city: name });
  const description = tm('cityHomeDescription', { city: name });

  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/${slug}`,
      // hreflang: каждый язык — отдельный документ, иначе они конкурируют
      // в выдаче. Локация в адрес входит, но между языками не меняется:
      // слуг/код один на все языки, переводится только название.
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [l, `/${l}/${slug}`])),
        'x-default': `/${DEFAULT_LOCALE}/${slug}`,
      },
    },
    ...socialMeta({ title, description, locale }),
  };
}

export default async function HomePage({ params }: Props) {
  const { locale, location } = await params;
  setRequestLocale(locale);

  // Неизвестный слуг/код — 404. Подставлять вместо него первую попавшуюся
  // локацию нельзя: чужая ссылка молча показала бы другой город или страну.
  const resolved = await requireLocation(locale, location);

  const th = await getTranslations({ locale, namespace: 'home' });

  // Срез запросов: конкретный город (как раньше) или вся страна разом,
  // если город не выбран (N-42) — каталог остаётся городским, у главной
  // единственной появился этот второй режим.
  const locator =
    resolved.type === 'city' ? { city: resolved.city.slug } : { country: resolved.country.code };
  const locationName = resolved.type === 'city' ? resolved.city.name : resolved.country.name;

  // Параллельно: пять независимых запросов, ждать их последовательно незачем.
  // revalidate передаём явно: Next берёт минимум из fetch-уровней, и без этого
  // дефолтные 60с молча переопределили бы объявленные на странице 300.
  // Локаль в кэш-ключ входит вместе с адресом: названия справочников
  // приходят из API переведёнными, и без неё ISR отдал бы чужой язык.
  const cache = { revalidate, locale };

  const emptyPage = { items: [], nextCursor: null, total: null };

  const [promo, top, escorts, escortCount, agencies, massage, massageCount] = await Promise.all([
    safely(fetchPromo(locator, cache), [], 'promo'),
    safely(fetchTopProfiles(locator, cache), emptyPage, 'top'),
    safely(fetchProfiles({ ...locator, kind: 'escort', limit: 20 }, cache), emptyPage, 'escorts'),
    safely(fetchProfileCount({ ...locator, kind: 'escort' }, cache), { total: 0 }, 'escortCount'),
    safely(fetchAgencies(locator, AGENCY_LIMIT, cache), [], 'agencies'),
    safely(fetchProfiles({ ...locator, kind: 'massage', limit: 10 }, cache), emptyPage, 'massage'),
    safely(fetchProfileCount({ ...locator, kind: 'massage' }, cache), { total: 0 }, 'massageCount'),
  ]);

  const nf = new Intl.NumberFormat(locale);
  // Каталог теперь понимает и страну целиком (N-43), поэтому «Показать всё»
  // ведёт туда же, куда сама эта главная: на город или на всю страну.
  const locationSlug =
    resolved.type === 'city' ? resolved.city.slug : resolved.country.code.toLowerCase();
  const catalogHref = (kind: 'escort' | 'massage') => `/${locationSlug}/catalog/${kind}`;

  return (
    <>
      <section className={styles.section}>
        <h1 className="visually-hidden">{th('escortSection', { city: locationName })}</h1>
        <PromoSlider slots={promo} />
      </section>

      {/* ТОП: случайные анкеты из оплаченных мест (§3.4). Пустой блок не
          рисуем — витрина без ТОПа не должна показывать пустой заголовок. */}
      {top.items.length > 0 ? (
        <section className={styles.section}>
          <SectionHead
            title={th('topSection', { city: locationName })}
            moreHref={`${catalogHref('escort')}?featuredOnly=true`}
            moreLabel={th('showAll')}
          />
          <ProfileGrid profiles={top.items} locale={locale as Locale} />
        </section>
      ) : null}

      <section className={styles.section}>
        {/* Локация — в пути, а не в `?city=`/`?country=`: параметры каталог
            не читает как срез (тот задаёт адрес), а путь без локации уводит
            редиректом на страну по умолчанию. */}
        <SectionHead
          title={th('escortSection', { city: locationName })}
          count={th('total', { count: nf.format(escortCount.total) })}
          moreHref={catalogHref('escort')}
          moreLabel={th('showAll')}
        />
        <ProfileGrid profiles={escorts.items} locale={locale as Locale} />
        {escortCount.total > escorts.items.length ? (
          <div className={styles.showAll}>
            <Link href={catalogHref('escort')}>
              <Button variant="secondary">
                {th('showAllProfiles', { count: nf.format(escortCount.total) })}
              </Button>
            </Link>
          </div>
        ) : null}
      </section>

      {/* Агентства — без счётчика и ссылки «показать всё»: своего каталога
          у них нет, а общее число агентств посетителю не нужно (N-44). */}
      {agencies.length > 0 ? (
        <section className={styles.section}>
          <SectionHead title={th('agenciesSection', { city: locationName })} />
          <AgencyGrid agencies={agencies} />
        </section>
      ) : null}

      {/* Массажные салоны, как ТОП и агентства, не рисуем пустым блоком —
          заголовок раздела без единой карточки под ним выглядит поломкой,
          а не честным «их пока нет». */}
      {massage.items.length > 0 ? (
        <section className={styles.section}>
          <SectionHead
            title={th('massageSection', { city: locationName })}
            count={th('total', { count: nf.format(massageCount.total) })}
            moreHref={catalogHref('massage')}
            moreLabel={th('showAll')}
          />
          <ProfileGrid profiles={massage.items} locale={locale as Locale} />
          {massageCount.total > massage.items.length ? (
            <div className={styles.showAll}>
              <Link href={catalogHref('massage')}>
                <Button variant="secondary">{th('showAllStudios')}</Button>
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
