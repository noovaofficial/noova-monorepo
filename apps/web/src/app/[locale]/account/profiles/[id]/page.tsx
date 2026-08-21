import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileEditor } from '@/modules/account/components/ProfileEditor';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('edit'), robots: { index: false, follow: false } };
}

export default async function EditProfilePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ProfileEditor profileId={id} />;
}
