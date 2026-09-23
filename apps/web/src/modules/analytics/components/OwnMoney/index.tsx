'use client';

import type { OwnMoneyAnalytics, OwnMoneyTotals } from '@noova/shared';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './OwnMoney.module.css';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  );
}

function Grid({ money }: { money: OwnMoneyTotals }) {
  const t = useTranslations('analytics');
  const format = useFormatter();
  const eur = format.number(money.paidEurCents / 100, { style: 'currency', currency: 'EUR' });

  return (
    <div className={styles.stats}>
      <Stat
        label={t('moneyPaid')}
        value={eur}
        hint={t('moneyTopups', { count: money.topupCount })}
      />
      <Stat
        label={t('moneyPurchased')}
        value={format.number(money.purchasedGc)}
        hint={t('moneyBonus', { count: money.bonusGc })}
      />
      <Stat label={t('moneyGifted')} value={format.number(money.giftedGc)} />
      <Stat label={t('moneyAdjusted')} value={format.number(money.adjustedGc)} />
      <Stat label={t('moneySpentListing')} value={format.number(money.spentListingGc)} />
      <Stat label={t('moneySpentTop')} value={format.number(money.spentTopGc)} />
    </div>
  );
}

/**
 * Деньги рекламодателя над отчётом по трафику: за выбранный период и за всё
 * время, плюс баланс и срок размещения. Урезанный вид того, что видит админ:
 * разбивка подарков по источнику и тариф агентства — только у админа.
 */
export function OwnMoney({ data }: { data: OwnMoneyAnalytics }) {
  const t = useTranslations('analytics');
  const format = useFormatter();

  return (
    <>
      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('moneyPeriodTitle')}</h2>
        <Grid money={data.period} />
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('moneyAllTimeTitle')}</h2>
        <Grid money={data.allTime} />
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('placementTitle')}</h2>
        <div className={styles.stats}>
          <Stat label={t('balance')} value={format.number(data.balanceGc)} />
          <Stat
            label={t('listing')}
            value={
              data.listing
                ? t('listingUntil', {
                    date: format.dateTime(new Date(data.listing.expiresAt), {
                      dateStyle: 'medium',
                    }),
                  })
                : t('listingNone')
            }
            hint={data.listing ? t(`listingStatus_${data.listing.status}`) : undefined}
          />
        </div>
      </section>
    </>
  );
}
