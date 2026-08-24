import type { ListingKind, Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { CatalogMap } from '@/modules/catalog/components/CatalogMap';
import { requireCity } from '@/shared/city';

type Props = { params: Promise<{ locale: Locale; city: string; kind: string }> };

const KINDS: ListingKind[] = ['escort', 'massage'];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'map' });

  return {
    title: t('title'),
    /**
     * Карта не индексируется. Она не несёт текста, который стоило бы искать,
     * и дублирует содержимое каталога — а дубль в индексе только отнимает
     * вес у самого каталога.
     */
    robots: { index: false, follow: true },
  };
}

export default async function CatalogMapPage({ params }: Props) {
  const { locale, city, kind } = await params;
  // Город проверяем и здесь: карта — такая же витринная страница.
  await requireCity(locale, city);
  setRequestLocale(locale);

  if (!KINDS.includes(kind as ListingKind)) notFound();

  // useSearchParams внутри требует границы Suspense: без неё страница
  // целиком уходит в клиентский рендер.
  return (
    <Suspense>
      <CatalogMap kind={kind as ListingKind} locale={locale} />
    </Suspense>
  );
}
