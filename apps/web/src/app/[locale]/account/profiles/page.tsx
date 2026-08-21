import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileList } from '@/modules/account/components/ProfileList';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  // Кабинет закрыт от индексации — там нет контента для выдачи.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function AccountProfilesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProfileList />;
}
