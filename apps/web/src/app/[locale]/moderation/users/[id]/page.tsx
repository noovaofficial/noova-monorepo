import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { UserDetail } from '@/modules/moderation/components/UserDetail';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'moderation' });
  return { title: t('userTitle'), robots: { index: false, follow: false } };
}

export default async function ModerationUserPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <UserDetail userId={id} />;
}
