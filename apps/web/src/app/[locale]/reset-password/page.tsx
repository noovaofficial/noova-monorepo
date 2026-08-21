import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResetPasswordConfirmForm } from '@/modules/auth/components/ResetPasswordConfirmForm';
import { ResetPasswordForm } from '@/modules/auth/components/ResetPasswordForm';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('resetTitle'), robots: { index: false, follow: true } };
}

export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Один маршрут на оба шага: без токена — запрос ссылки, с токеном — ввод
  // нового пароля. Так ссылка из письма ведёт туда же, куда и кнопка в форме.
  const { token } = await searchParams;
  return token ? <ResetPasswordConfirmForm token={token} /> : <ResetPasswordForm />;
}
