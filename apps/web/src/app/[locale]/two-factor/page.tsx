import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TwoFactor } from '@/modules/auth/components/TwoFactor';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('twoFactorTitle'), robots: { index: false, follow: false } };
}

/** Второй фактор сотрудника: ввод кода при входе или первая настройка. */
export default async function TwoFactorPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TwoFactor />;
}
