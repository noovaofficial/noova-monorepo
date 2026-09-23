'use client';

import type {
  AdminAdvertiserAnalytics,
  AdvertiserMoneyTotals,
  AnalyticsPeriod,
} from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { AnalyticsReport } from '@/modules/analytics/components/AnalyticsPanel';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchAdvertiserAnalytics } from '@/modules/moderation/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './AdvertiserAnalytics.module.css';

/**
 * Аналитика рекламодателя глазами админа (только админ): обычный отчёт по
 * трафику, что видит сам рекламодатель, а над ним — деньги (внесено, коины,
 * подарки, траты), размещение и последние операции.
 */
export function AdvertiserAnalytics({ userId }: { userId: string }) {
  const t = useTranslations('analytics');
  const { user, status } = useSession();
  const router = useRouter();
  const isAdmin = user?.role === 'admin';

  const [period, setPeriod] = useState<AnalyticsPeriod>('d30');
  const query = useQuery({
    queryKey: queryKeys.advertiserAnalytics(userId, period),
    queryFn: () => fetchAdvertiserAnalytics(userId, period),
    enabled: status === 'authenticated' && isAdmin,
    staleTime: 60 * 1000,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;
  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }
  if (!isAdmin) return <p className={styles.empty}>{t('adminOnly')}</p>;

  const data = query.data ?? null;

  return (
    <AnalyticsReport
      title={
        data ? (
          <>
            {t('adminTitle')}
            <span className={styles.who}>
              {data.advertiser.name ? `${data.advertiser.name} | ` : ''}
              {data.advertiser.email}
            </span>
          </>
        ) : (
          t('adminTitle')
        )
      }
      period={period}
      onPeriodChange={setPeriod}
      data={data?.traffic ?? null}
      isPending={query.isPending}
      isError={query.isError}
      extra={data ? <MoneyBlocks data={data} /> : null}
    />
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  );
}

function MoneyGrid({ money }: { money: AdvertiserMoneyTotals }) {
  const t = useTranslations('analytics');
  const format = useFormatter();
  const eur = (cents: number) => format.number(cents / 100, { style: 'currency', currency: 'EUR' });
  const gc = (value: number) => format.number(value);

  return (
    <div className={styles.stats}>
      <Stat
        label={t('moneyPaid')}
        value={eur(money.paidEurCents)}
        hint={t('moneyTopups', { count: money.topupCount })}
      />
      <Stat
        label={t('moneyPurchased')}
        value={gc(money.purchasedGc)}
        hint={t('moneyBonus', { count: money.bonusGc })}
      />
      <Stat label={t('moneyGiftedAdmin')} value={gc(money.giftedAdminGc)} />
      <Stat label={t('moneyGiftedCampaign')} value={gc(money.giftedCampaignGc)} />
      <Stat label={t('moneyGiftedOther')} value={gc(money.giftedOtherGc)} />
      <Stat label={t('moneyDeducted')} value={gc(money.deductedAdminGc)} />
      <Stat label={t('moneySpentListing')} value={gc(money.spentListingGc)} />
      <Stat label={t('moneySpentTop')} value={gc(money.spentTopGc)} />
    </div>
  );
}

function MoneyBlocks({ data }: { data: AdminAdvertiserAnalytics }) {
  const t = useTranslations('analytics');
  const format = useFormatter();

  return (
    <>
      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('moneyPeriodTitle')}</h2>
        <MoneyGrid money={data.money.period} />
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('moneyAllTimeTitle')}</h2>
        <MoneyGrid money={data.money.allTime} />
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
          {data.tariffTier ? <Stat label={t('tariffTier')} value={data.tariffTier} /> : null}
        </div>
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('transactionsTitle')}</h2>
        {data.transactions.length === 0 ? (
          <p className={styles.muted}>{t('transactionsEmpty')}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('txDate')}</th>
                  <th scope="col">{t('txKind')}</th>
                  <th scope="col" className={styles.num}>
                    {t('txGc')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('txEur')}
                  </th>
                  <th scope="col">{t('txNote')}</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      {format.dateTime(new Date(tx.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>{t(`txKind_${tx.kind}`)}</td>
                    <td className={styles.num}>
                      {tx.gcAmount > 0 ? '+' : ''}
                      {format.number(tx.gcAmount)}
                    </td>
                    <td className={styles.num}>
                      {tx.eurPaidCents === null
                        ? '—'
                        : format.number(tx.eurPaidCents / 100, {
                            style: 'currency',
                            currency: 'EUR',
                          })}
                    </td>
                    <td>{tx.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** Кнопка-ссылка «Аналитика» на страницу выше — из списков и карточек админа. */
export function AdvertiserAnalyticsLink({ userId }: { userId: string }) {
  const t = useTranslations('analytics');
  return (
    <Link href={`/admin/advertisers/${userId}/analytics`}>
      <Button variant="secondary">{t('openAnalytics')}</Button>
    </Link>
  );
}
