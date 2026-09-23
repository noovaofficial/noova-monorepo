import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdvertiserOverview } from '@/modules/moderation/components/AdvertiserOverview';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: t('ovTitle'), robots: { index: false, follow: false } };
}

export default async function AdvertiserOverviewPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdvertiserOverview />;
}
