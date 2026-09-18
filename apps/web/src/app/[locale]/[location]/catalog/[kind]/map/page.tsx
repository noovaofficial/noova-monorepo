import type { ListingKind, Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { CatalogMap } from '@/modules/catalog/components/CatalogMap';
import { requireLocation } from '@/shared/city';
import { socialMeta } from '@/shared/metadata';

type Props = { params: Promise<{ locale: Locale; location: string; kind: string }> };

const KINDS: ListingKind[] = ['escort', 'massage'];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'map' });
  const title = t('title');
  const description = t('description');

  return {
    title,
    description,
    /**
     * Карта не индексируется. Она не несёт текста, который стоило бы искать,
     * и дублирует содержимое каталога — а дубль в индексе только отнимает
     * вес у самого каталога.
     */
    robots: { index: false, follow: true },
    ...socialMeta({ title, description, locale }),
  };
}

export default async function CatalogMapPage({ params }: Props) {
  const { locale, location, kind } = await params;
  // Локацию проверяем и здесь: карта — такая же витринная страница, что и
  // каталог, с тем же выбором «город или вся страна» (N-43).
  const resolved = await requireLocation(locale, location);
  setRequestLocale(locale);

  if (!KINDS.includes(kind as ListingKind)) notFound();

  const locator =
    resolved.type === 'city' ? { city: resolved.city.slug } : { country: resolved.country.code };

  // useSearchParams внутри требует границы Suspense: без неё страница
  // целиком уходит в клиентский рендер.
  return (
    <Suspense>
      <CatalogMap
        kind={kind as ListingKind}
        location={location}
        locator={locator}
        locale={locale}
      />
    </Suspense>
  );
}
