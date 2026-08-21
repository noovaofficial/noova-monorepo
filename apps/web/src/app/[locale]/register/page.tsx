import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { RegisterForm } from '@/modules/auth/components/RegisterForm';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('registerTitle'), robots: { index: false, follow: true } };
}

export default async function RegisterPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // useSearchParams внутри формы требует границы Suspense: без неё страница
  // целиком уходит в клиентский рендер и перестаёт быть статической.
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
