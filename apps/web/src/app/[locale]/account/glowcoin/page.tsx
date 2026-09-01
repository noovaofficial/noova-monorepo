import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GlowCoinWallet } from '@/modules/billing/components/GlowCoinWallet';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'billing' });
  // Кошелёк — личная страница: в выдаче ей нечего делать.
  return { title: t('walletTitle'), robots: { index: false, follow: false } };
}

export default async function GlowCoinPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <GlowCoinWallet />;
}
