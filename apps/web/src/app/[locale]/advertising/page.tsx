import { DEFAULT_BILLING_CONFIG, gcToEur, LOCALES, PLAN_KINDS, toPriceBook } from '@noova/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import styles from '@/modules/content/components/ContentPage/ContentPage.module.css';
import { fetchPriceBook, safely } from '@/shared/api';
import { Link } from '@/shared/i18n/navigation';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'advertising' });

  return {
    title: t('title'),
    description: t('lead'),
    alternates: {
      canonical: `/${locale}/advertising`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/advertising`])),
    },
  };
}

/**
 * Тарифы размещения. Цены приходят из прайса на сервере — того же, что
 * правит админ на `/admin/monetization`: витрина и касса не могут разойтись.
 *
 * Показываем только нижнюю границу — месячный срок. Полная сетка (сроки,
 * бонусная лестница пополнений) живёт в кабинете перед оплатой: на витрине
 * она превращает страницу в прайс-лист и ничего не объясняет тому, кто
 * ещё выбирает.
 */
export default async function AdvertisingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'advertising' });

  // Недоступный API не должен ронять витрину: цены по умолчанию — это те же
  // цены из payments.md, с которых прайс и начинался.
  const book = await safely(fetchPriceBook(), toPriceBook(DEFAULT_BILLING_CONFIG), 'priceBook');

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lead}>{t('lead')}</p>

      <div className={styles.currency}>
        <GlowCoinIcon className={styles.currencyIcon} size={40} />
        <div>
          <div className={styles.currencyName}>{t('currencyName')}</div>
          <div className={styles.currencyMeta}>
            <span className={styles.currencyTicker}>{t('currencyTicker')}</span> ·{' '}
            {t('currencyRate', { rate: book.gcPerEur })}
          </div>
          <p className={styles.currencyText}>{t('currencyText')}</p>
        </div>
      </div>

      <div className={styles.plans}>
        {PLAN_KINDS.map((kind) => {
          // Месячный срок — минимальная цена: начинать разговор с «990 GC»
          // значит отпугнуть ценой, которую никто не обязан платить сразу.
          const gc = book.prices[kind].m1;
          return (
            <div className={styles.plan} key={kind}>
              <div className={styles.planName}>{t(`plan_${kind}`)}</div>
              <div className={styles.planPrice}>
                {t('priceFrom', { amount: gc })}
                <span className={styles.planPeriod}> {t('perMonth')}</span>
              </div>
              <div className={styles.planPriceEur}>
                {t('priceEur', { amount: gcToEur(gc, book.gcPerEur) })}
              </div>
            </div>
          );
        })}
      </div>

      <p className={styles.note}>{t('priceNote')}</p>

      <section className={styles.section} style={{ marginTop: 'var(--space8)' }}>
        <h2 className={styles.sectionTitle}>{t('includedTitle')}</h2>
        <ul className={styles.list}>
          <li>{t('includedPlacement')}</li>
          <li>{t('includedPhotos')}</li>
          <li>{t('includedContacts')}</li>
          <li>{t('includedStats')}</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('howTitle')}</h2>
        <p className={styles.text}>
          {t.rich('howText', {
            register: (chunks) => <Link href="/register">{chunks}</Link>,
            contact: (chunks) => <Link href="/contact">{chunks}</Link>,
          })}
        </p>
      </section>
    </div>
  );
}
