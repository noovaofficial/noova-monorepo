import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TopNow } from '@/modules/moderation/components/TopNow';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('topNow'), robots: { index: false, follow: false } };
}

export default async function TopNowPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TopNow />;
}
