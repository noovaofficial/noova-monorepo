import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CityTopSettings } from '@/modules/billing/components/CityTopSettings';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'billing' });
  return { title: t('cityTopTitle'), robots: { index: false, follow: false } };
}

export default async function CityTopPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CityTopSettings />;
}
