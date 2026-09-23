import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OwnProfileRedirect } from '@/modules/account/components/OwnProfileRedirect';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('myProfile'), robots: { index: false, follow: false } };
}

export default async function AccountOwnProfilePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OwnProfileRedirect />;
}
