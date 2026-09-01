import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import { gcToEur, MIN_PLAN_GC } from '@/modules/billing/pricing';
import styles from '@/modules/content/components/ContentPage/ContentPage.module.css';
import { Link } from '@/shared/i18n/navigation';

type Props = { params: Promise<{ locale: string }> };

/**
 * Тарифы размещения. Числа берём из общего прайса, а не из словарей: цена одна
 * на все языки, и три копии в трёх файлах однажды разойдутся — в одном из них
 * останется старая.
 *
 * Показываем только нижнюю границу — месячный срок. Полная сетка (сроки,
 * доп.анкеты агентства, бонусная лестница пополнений) живёт в кабинете перед
 * оплатой: на витрине она превращает страницу в прайс-лист и ничего не
 * объясняет тому, кто ещё выбирает.
 */
const PLANS = [
  { key: 'individual', gc: MIN_PLAN_GC.individual },
  { key: 'salon', gc: MIN_PLAN_GC.salon },
  { key: 'agency', gc: MIN_PLAN_GC.agency },
] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'advertising' });

  return {
    title: t('title'),
    description: t('lead'),
    alternates: {
      canonical: `/${locale}/advertising`,
      languages: { de: '/de/advertising', en: '/en/advertising', ru: '/ru/advertising' },
    },
  };
}

export default async function AdvertisingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'advertising' });

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
            {t('currencyRate')}
          </div>
          <p className={styles.currencyText}>{t('currencyText')}</p>
        </div>
      </div>

      <div className={styles.plans}>
        {PLANS.map((plan) => (
          <div className={styles.plan} key={plan.key}>
            <div className={styles.planName}>{t(`plan_${plan.key}`)}</div>
            <div className={styles.planPrice}>
              {t('priceFrom', { amount: plan.gc })}
              <span className={styles.planPeriod}> {t('perMonth')}</span>
            </div>
            <div className={styles.planPriceEur}>{t('priceEur', { amount: gcToEur(plan.gc) })}</div>
          </div>
        ))}
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
