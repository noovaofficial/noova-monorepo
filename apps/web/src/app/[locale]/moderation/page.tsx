import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ModerationQueue } from '@/modules/moderation/components/ModerationQueue';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'moderation' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function ModerationPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ModerationQueue />;
}
