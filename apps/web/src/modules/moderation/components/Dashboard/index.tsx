'use client';

import { ANALYTICS_PERIODS, type AnalyticsPeriod, type Dashboard } from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { DailyChart } from '@/modules/analytics/components/DailyChart';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchDashboard } from '@/modules/moderation/api';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './Dashboard.module.css';

/**
 * Внутренний дашборд (фаза 6, только админ): источники и кампании с долей
 * ботов, спрос по городам против числа анкет, выручка по дням. Все три
 * читают только роллапы на сервере (`SourceDailyStat`, `CityDailyStat`,
 * `BillingTransaction` по дню) — сырой журнал событий здесь не сканируется.
 */
export function InternalDashboard() {
  const t = useTranslations('analytics');
  const { user, status } = useSession();
  const router = useRouter();
  const isAdmin = user?.role === 'admin';

  const [period, setPeriod] = useState<AnalyticsPeriod>('d30');
  const query = useQuery({
    queryKey: queryKeys.dashboard(period),
    queryFn: () => fetchDashboard(period),
    enabled: status === 'authenticated' && isAdmin,
    staleTime: 60 * 1000,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;
  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }
  if (!isAdmin) return <p className={styles.empty}>{t('adminOnly')}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('dashTitle')}</h1>
        {/* biome-ignore lint/a11y/useSemanticElements: группа переключателей, а не поле формы */}
        <div className={styles.periods} role="group" aria-label={t('periodLabel')}>
          {ANALYTICS_PERIODS.map((option) => (
            <button
              type="button"
              key={option}
              className={`${styles.period} ${period === option ? styles.periodSelected : ''}`}
              aria-pressed={period === option}
              onClick={() => setPeriod(option)}
            >
              {t(`period_${option}`)}
            </button>
          ))}
        </div>
      </div>

      {query.isPending ? <p className={styles.empty}>{t('loading')}</p> : null}
      {query.isError ? <p className={styles.err}>{t('loadFailed')}</p> : null}

      {query.data ? <Report data={query.data} /> : null}
    </div>
  );
}

/**
 * Сама отрисовка — отдельным компонентом, а не веткой в `InternalDashboard`:
 * `useFormatter` нужен только когда данные уже пришли, а хуки нельзя звать
 * условно. Разделение на компоненты — единственный способ и получить
 * данные раньше форматтера, и не звать хук через раз.
 */
function Report({ data }: { data: Dashboard }) {
  const t = useTranslations('analytics');
  const format = useFormatter();

  return (
    <>
      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('dashSourcesTitle')}</h2>
        <p className={styles.hint}>{t('dashSourcesHint')}</p>
        {data.sources.rows.length === 0 ? (
          <p className={styles.muted}>{t('dashEmpty')}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('dashColSource')}</th>
                  <th scope="col">{t('dashColCampaign')}</th>
                  <th scope="col" className={styles.num}>
                    {t('dashColSessions')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('dashColBotShare')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('dashColContacts')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('dashColCostPerContact')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.sources.rows.map((row) => (
                  <tr key={`${row.source}:${row.network}:${row.utmCampaign}`}>
                    <th scope="row">
                      {t(`dashSource_${row.source}`)}
                      {row.network ? <span className={styles.sub}>{row.network}</span> : null}
                    </th>
                    <td>{row.utmCampaign || '—'}</td>
                    <td className={styles.num}>{format.number(row.sessions)}</td>
                    <td className={styles.num}>
                      {row.sessions > 0
                        ? format.number(row.botSessions / row.sessions, { style: 'percent' })
                        : '—'}
                    </td>
                    <td className={styles.num}>{format.number(row.contacts)}</td>
                    <td className={styles.num}>
                      {row.costPerContactEurCents === null
                        ? t('dashCostPending')
                        : format.number(row.costPerContactEurCents / 100, {
                            style: 'currency',
                            currency: 'EUR',
                          })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('dashCitiesTitle')}</h2>
        <p className={styles.hint}>{t('dashCitiesHint')}</p>
        {data.cities.rows.length === 0 ? (
          <p className={styles.muted}>{t('dashEmpty')}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('dashColCity')}</th>
                  <th scope="col">{t('dashColCategory')}</th>
                  <th scope="col" className={styles.num}>
                    {t('dashColProfileViews')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('dashColContacts')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('dashColActiveProfiles')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('dashColPerProfile')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.cities.rows.map((row) => (
                  <tr
                    key={`${row.city}:${row.category}`}
                    className={row.highDemand ? styles.flaggedRow : undefined}
                  >
                    <th scope="row">
                      {row.city}
                      {row.highDemand ? (
                        <span className={styles.badge}>{t('dashHighDemand')}</span>
                      ) : null}
                    </th>
                    <td>{t(`dashKind_${row.category}`)}</td>
                    <td className={styles.num}>{format.number(row.profileViews)}</td>
                    <td className={styles.num}>{format.number(row.contacts)}</td>
                    <td className={styles.num}>{format.number(row.activeProfiles)}</td>
                    <td className={styles.num}>
                      {row.contactsPerProfile === null
                        ? '—'
                        : format.number(row.contactsPerProfile, { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>{t('dashRevenueTitle')}</h2>
        <p className={styles.hint}>{t('dashRevenueHint')}</p>
        <div className={styles.cards}>
          <RevenueStat
            label={t('dashColTopup')}
            value={format.number(data.revenue.totals.topupEurCents / 100, {
              style: 'currency',
              currency: 'EUR',
            })}
          />
          <RevenueStat
            label={t('dashColListing')}
            value={format.number(data.revenue.totals.spentListingGc)}
          />
          <RevenueStat
            label={t('dashColTop')}
            value={format.number(data.revenue.totals.spentTopGc)}
          />
        </div>
        <DailyChart
          label={t('dashRevenueChartLabel')}
          points={data.revenue.series.map((point) => ({
            date: point.date,
            value: point.topupEurCents / 100,
          }))}
          formatValue={(value) => format.number(value, { style: 'currency', currency: 'EUR' })}
        />
      </section>
    </>
  );
}

function RevenueStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValue}>{value}</span>
    </div>
  );
}
