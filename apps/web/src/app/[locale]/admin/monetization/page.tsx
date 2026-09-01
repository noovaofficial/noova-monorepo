import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MonetizationSettings } from '@/modules/billing/components/MonetizationSettings';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('monetization'), robots: { index: false, follow: false } };
}

export default async function MonetizationPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MonetizationSettings />;
}
