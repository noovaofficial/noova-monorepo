import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CityDetail } from '@/modules/locations/components/CityDetail';

type Props = { params: Promise<{ locale: Locale; code: string; city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('locations'), robots: { index: false, follow: false } };
}

export default async function CityPage({ params }: Props) {
  const { locale, code, city } = await params;
  setRequestLocale(locale);
  return <CityDetail countryCode={code} citySlug={city} />;
}
