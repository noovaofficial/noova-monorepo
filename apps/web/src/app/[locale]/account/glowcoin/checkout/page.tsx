import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import styles from '@/modules/billing/components/GlowCoinWallet/GlowCoinWallet.module.css';
import { findPack } from '@/modules/billing/pricing';
import { Link } from '@/shared/i18n/navigation';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ pack?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'billing' });
  return { title: t('checkoutTitle'), robots: { index: false, follow: false } };
}

/**
 * Заглушка кассы. Кнопки пополнения обязаны куда-то вести уже сейчас — иначе
 * экран кошелька не проверить целиком, — но платёжного провайдера ещё нет.
 * Страница честно говорит, что оплата не прошла, и не делает вид, что
 * что-то списала.
 *
 * При подключении кассы отсюда уходит редирект на провайдера, а `checkoutUrl`
 * в `billing/pricing.ts` начинает возвращать его адрес.
 */
export default async function GlowCoinCheckoutPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { pack: raw } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'billing' });

  const pack = findPack(Number(raw));

  return (
    <div className={styles.checkout}>
      <h1 className={styles.title}>{t('checkoutTitle')}</h1>

      {pack ? (
        <>
          <div className={styles.checkoutSum}>
            {pack.gc} {t('ticker')}
          </div>
          <p className={styles.text}>{t('packPrice', { amount: pack.eur })}</p>
        </>
      ) : (
        <p className={styles.text}>{t('checkoutUnknownPack')}</p>
      )}

      <p className={styles.note}>{t('checkoutStub')}</p>

      <Link className={styles.back} href="/account/glowcoin">
        {t('checkoutBack')}
      </Link>
    </div>
  );
}
