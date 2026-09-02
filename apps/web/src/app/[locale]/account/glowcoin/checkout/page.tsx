import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import styles from '@/modules/billing/components/GlowCoinWallet/GlowCoinWallet.module.css';
import { TopupStatus } from '@/modules/billing/components/TopupStatus';
import { Link } from '@/shared/i18n/navigation';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ order?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'billing' });
  return { title: t('checkoutTitle'), robots: { index: false, follow: false } };
}

/**
 * Возврат с кассы Paymento: сюда шлюз отправляет человека после оплаты
 * (или отказа). Сам заказ и его состояние показывает клиентский компонент —
 * зачисление приходит колбэком позже, и страница должна дождаться его.
 */
export default async function GlowCoinCheckoutPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { order } = await searchParams;

  if (!order) {
    const t = await getTranslations({ locale, namespace: 'billing' });
    return (
      <div className={styles.checkout}>
        <h1 className={styles.title}>{t('checkoutTitle')}</h1>
        <p className={styles.text}>{t('checkoutMissing')}</p>
        <Link className={styles.back} href="/account/glowcoin">
          {t('checkoutBack')}
        </Link>
      </div>
    );
  }

  return <TopupStatus orderId={order} />;
}
