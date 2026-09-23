import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdvertiserAnalytics } from '@/modules/moderation/components/AdvertiserAnalytics';

type Props = { params: Promise<{ locale: Locale; userId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: t('adminTitle'), robots: { index: false, follow: false } };
}

export default async function AdvertiserAnalyticsPage({ params }: Props) {
  const { locale, userId } = await params;
  setRequestLocale(locale);
  return <AdvertiserAnalytics userId={userId} />;
}
