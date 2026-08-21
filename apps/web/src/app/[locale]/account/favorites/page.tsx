import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FavoritesList } from '@/modules/favorites/components/FavoritesList';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'favorites' });

  return {
    title: t('title'),
    // Личная страница: индексировать её нечего, а попади она в выдачу —
    // это была бы ссылка на чужой список, ведущая на форму входа.
    robots: { index: false, follow: false },
  };
}

export default async function FavoritesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <FavoritesList locale={locale} />;
}
