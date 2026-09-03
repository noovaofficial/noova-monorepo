import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CampaignsAdmin } from '@/modules/campaigns/components/CampaignsAdmin';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'campaigns' });
  // Служебная страница: в выдаче ей нечего делать.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CampaignsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CampaignsAdmin />;
}
