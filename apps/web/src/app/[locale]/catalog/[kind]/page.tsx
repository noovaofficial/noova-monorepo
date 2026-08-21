import { type ListingKind, listingKindSchema } from '@noova/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogResults } from '@/modules/catalog/components/CatalogResults';
import { parseFilters } from '@/modules/filters/params';
import { fetchProfileCount, fetchProfiles, safely } from '@/shared/api';
import styles from './page.module.css';

type Props = {
  params: Promise<{ locale: string; kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const DEFAULT_CITY_NAME = 'Berlin';
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
  const { locale, kind } = await params;
  const search = await searchParams;
  const t = await getTranslations({ locale, namespace: 'filters' });

  const title = t(kind === 'massage' ? 'catalogMassage' : 'catalogEscort', {
    city: DEFAULT_CITY_NAME,
  });

  const filtered = appliedFilterCount(search) > 0;

  return {
    title,
    alternates: {
      // canonical всегда на базовый срез: страницы выдачи — это один и тот же
      // раздел, а не разные документы.
      canonical: `/${locale}/catalog/${kind}`,
    },
    // Комбинации фильтров порождают тысячи почти одинаковых страниц. Индексируем
    // только базовый срез, остальное закрываем — иначе поисковик утонет
    // в дублях, и от этого пострадают основные страницы.
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function CatalogPage({ params, searchParams }: Props) {
  const { locale, kind: rawKind } = await params;
  setRequestLocale(locale);

  const parsedKind = listingKindSchema.safeParse(rawKind);
  if (!parsedKind.success) notFound();
  const kind: ListingKind = parsedKind.data;

  const search = await searchParams;
  const t = await getTranslations({ locale, namespace: 'filters' });
  const query = { ...parseFilters(search), kind };
  const pageNumber = query.page ?? 1;

  const [page, total] = await Promise.all([
    safely(
      fetchProfiles({ ...query, limit: PAGE_SIZE, page: pageNumber }),
      { items: [], nextCursor: null, total: null },
      'catalog',
    ),
    safely(fetchProfileCount(query), { total: 0 }, 'catalogCount'),
  ]);

  const nf = new Intl.NumberFormat(locale);
  // Строка запроса без номера страницы: он нужен ссылкам пагинации и подгрузке,
  // но каждая из них подставляет его сама.
  const queryString = new URLSearchParams(
    Object.entries(search).flatMap(([key, value]) =>
      value === undefined || key === 'page'
        ? []
        : Array.isArray(value)
          ? value.map((item) => [key, item] as [string, string])
          : [[key, value] as [string, string]],
    ),
  ).toString();

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>
          {t(kind === 'massage' ? 'catalogMassage' : 'catalogEscort', { city: DEFAULT_CITY_NAME })}
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
          query={queryString}
          total={total.total}
          basePath={`/catalog/${kind}`}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
