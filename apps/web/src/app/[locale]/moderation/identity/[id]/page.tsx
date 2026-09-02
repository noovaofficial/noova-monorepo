import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VerificationReview } from '@/modules/moderation/components/VerificationReview';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'moderation' });
  return { title: t('tabIdentity'), robots: { index: false, follow: false } };
}

export default async function IdentityReviewPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <VerificationReview requestId={id} />;
}
