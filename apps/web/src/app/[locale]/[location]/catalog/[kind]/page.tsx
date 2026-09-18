import { type ListingKind, type Locale, listingKindSchema } from '@noova/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogResults } from '@/modules/catalog/components/CatalogResults';
import { parseFilters } from '@/modules/filters/params';
import { fetchProfileCount, fetchProfiles, safely } from '@/shared/api';
import { requireLocation } from '@/shared/city';
import { socialMeta } from '@/shared/metadata';
import styles from './page.module.css';

type Props = {
  params: Promise<{ locale: Locale; location: string; kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 24;

/** Ключи, наличие которых делает страницу «глубокой» выдачей. */
const FILTER_KEYS = new Set([
  'services',
  'hairColor',
  'eyeColor',
  'breastSize',
  'breastType',
  'bodyType',
  'pubicHair',
  'appearanceType',
  'languages',
  'ageMin',
  'ageMax',
  'heightMin',
  'heightMax',
  'weightMin',
  'weightMax',
  'minPriceCents',
  'maxPriceCents',
  'onlineOnly',
  'verifiedOnly',
  'district',
  // Несколько городов внутри страны — такой же срез, как остальные фильтры,
  // не структурный параметр (N-43).
  'cities',
]);

function appliedFilterCount(search: Record<string, string | string[] | undefined>): number {
  let count = 0;
  for (const [key, value] of Object.entries(search)) {
    if (!FILTER_KEYS.has(key) || value === undefined) continue;
    count += Array.isArray(value) ? value.length : 1;
  }
  return count;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, location, kind } = await params;
  const search = await searchParams;
  const t = await getTranslations({ locale, namespace: 'filters' });
  const isMassage = kind === 'massage';
  const resolved = await requireLocation(locale, location);
  // Канонический слуг — код страны нормализуем в нижний регистр, как и на
  // главной: иначе `/DE/catalog/escort` и `/de/catalog/escort` были бы
  // двумя разными документами.
  const slug = resolved.type === 'city' ? resolved.city.slug : resolved.country.code.toLowerCase();
  const locationName = resolved.type === 'city' ? resolved.city.name : resolved.country.name;

  const title = t(isMassage ? 'catalogMassage' : 'catalogEscort', { city: locationName });
  const description = t(isMassage ? 'catalogMassageDescription' : 'catalogEscortDescription', {
    city: locationName,
  });

  const filtered = appliedFilterCount(search) > 0;

  return {
    title,
    description,
    alternates: {
      // canonical всегда на базовый срез: страницы выдачи — это один и тот же
      // раздел, а не разные документы.
      canonical: `/${locale}/${slug}/catalog/${kind}`,
    },
    // Комбинации фильтров порождают тысячи почти одинаковых страниц. Индексируем
    // только базовый срез, остальное закрываем — иначе поисковик утонет
    // в дублях, и от этого пострадают основные страницы.
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
    ...socialMeta({ title, description, locale }),
  };
}

export default async function CatalogPage({ params, searchParams }: Props) {
  const { locale, location, kind: rawKind } = await params;
  setRequestLocale(locale);

  const parsedKind = listingKindSchema.safeParse(rawKind);
  if (!parsedKind.success) notFound();
  const kind: ListingKind = parsedKind.data;

  const search = await searchParams;
  const t = await getTranslations({ locale, namespace: 'filters' });
  // Локация из адреса задаёт срез каталога и не переопределяется фильтрами:
  // иначе `/berlin/catalog/escort?city=wien` показал бы чужой город. Город
  // точнее страны — если он есть в адресе, каталог городской, как и был;
  // код страны даёт срез по всей стране (N-43), который дальше можно сузить
  // фильтром `cities` до нескольких конкретных городов.
  const resolved = await requireLocation(locale, location);
  const locationName = resolved.type === 'city' ? resolved.city.name : resolved.country.name;
  const locator =
    resolved.type === 'city' ? { city: resolved.city.slug } : { country: resolved.country.code };

  const query = { ...parseFilters(search), kind, ...locator };
  const pageNumber = query.page ?? 1;

  const [page, total] = await Promise.all([
    safely(
      fetchProfiles({ ...query, limit: PAGE_SIZE, page: pageNumber }, { locale }),
      { items: [], nextCursor: null, total: null },
      'catalog',
    ),
    safely(fetchProfileCount(query, { locale }), { total: 0 }, 'catalogCount'),
  ]);

  const nf = new Intl.NumberFormat(locale);
  // Строка запроса без номера страницы: он нужен ссылкам пагинации и подгрузке,
  // но каждая из них подставляет его сама. Город/страна в путь не входят
  // (он в адресе), но клиентской подгрузке и карте нужны явно — добавляем
  // их поверх фильтров пользователя, а не вместо них.
  const queryString = new URLSearchParams(
    Object.entries(search).flatMap(([key, value]) =>
      value === undefined || key === 'page'
        ? []
        : Array.isArray(value)
          ? value.map((item) => [key, item] as [string, string])
          : [[key, value] as [string, string]],
    ),
  );
  queryString.set('kind', kind);
  if (locator.city) queryString.set('city', locator.city);
  if (locator.country) queryString.set('country', locator.country);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>
          {t(kind === 'massage' ? 'catalogMassage' : 'catalogEscort', { city: locationName })}
          <span className={styles.count}>{t('found', { count: nf.format(total.total) })}</span>
        </h1>
      </div>

      {page.items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('empty')}</p>
          <p>{t('emptyHint')}</p>
        </div>
      ) : (
        <CatalogResults
          locale={locale as never}
          initialItems={page.items}
          initialCursor={page.nextCursor}
          query={queryString.toString()}
          total={total.total}
          basePath={`/${location}/catalog/${kind}`}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
