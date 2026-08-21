import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ModerationLog } from '@/modules/moderation/components/ModerationLog';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  // Служебная страница: в выдаче ей нечего делать.
  return { title: t('logTitle'), robots: { index: false, follow: false } };
}

export default async function ModerationLogPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ModerationLog />;
}
