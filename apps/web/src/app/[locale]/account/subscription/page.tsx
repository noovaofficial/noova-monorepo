import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SubscriptionPanel } from '@/modules/billing/components/SubscriptionPanel';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'billing' });
  // Личная страница: в выдаче ей нечего делать.
  return { title: t('subscriptionTitle'), robots: { index: false, follow: false } };
}

export default async function SubscriptionPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SubscriptionPanel />;
}
