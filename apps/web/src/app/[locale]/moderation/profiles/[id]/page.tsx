import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileReview } from '@/modules/moderation/components/ProfileReview';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'moderation' });
  return { title: t('profileTitle'), robots: { index: false, follow: false } };
}

export default async function ModerationProfilePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ProfileReview profileId={id} />;
}
