'use client';

import {
  DASHBOARD_PERIODS,
  type Dashboard,
  type DashboardPeriod,
  type TrafficQuality,
} from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { DailyChart } from '@/modules/analytics/components/DailyChart';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchDashboard, fetchTrafficQuality } from '@/modules/moderation/api';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './Dashboard.module.css';

/**
 * Внутренний дашборд (фаза 6, только админ): источники и кампании с долей
 * ботов, спрос по городам против числа анкет, выручка по дням. Все три
 * читают только роллапы на сервере (`SourceDailyStat`, `CityDailyStat`,
 * `BillingTransaction` по дню) — сырой журнал событий здесь не сканируется.
 */
/** Сегодня по местному времени браузера, `YYYY-MM-DD` — верхняя граница
 *  выбора даты. Не берлинское «сегодня»: разница на час-два около полуночи
 *  не стоит того, чтобы тащить часовой пояс в клиентский код ради одной
 *  границы `max` у `<input type="date">`. */
function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function InternalDashboard() {
  const t = useTranslations('analytics');
  const { user, status } = useSession();
  const router = useRouter();
  const isAdmin = user?.role === 'admin';
  const dateInputId = useId();

  const [period, setPeriod] = useState<DashboardPeriod>('d30');
  // `null` — обычный режим, пресетами; строка — выбрана конкретная дата,
  // она перекрывает период (см. `fetchDashboard`/API). Отдельное поле, а не
  // пятый пункт в `period`: дата — любая, выбранная руками, не фиксированный
  // пресет, и хранить её тем же полем значило бы постоянно решать, что в
  // нём лежит — код пресета или ISO-дата.
  const [date, setDate] = useState<string | null>(null);

  const selectPeriod = (option: DashboardPeriod) => {
    setPeriod(option);
    setDate(null);
  };

  const query = useQuery({
    queryKey: queryKeys.dashboard(period, date ?? undefined),
    queryFn: () => fetchDashboard({ period, date: date ?? undefined }),
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
        <div className={styles.controls}>
          {/* biome-ignore lint/a11y/useSemanticElements: группа переключателей, а не поле формы */}
          <div className={styles.periods} role="group" aria-label={t('periodLabel')}>
            {DASHBOARD_PERIODS.map((option) => (
              <button
                type="button"
                key={option}
                className={`${styles.period} ${period === option && !date ? styles.periodSelected : ''}`}
                aria-pressed={period === option && !date}
                onClick={() => selectPeriod(option)}
              >
                {t(`period_${option}`)}
              </button>
            ))}
          </div>
          <label className={styles.dateField} htmlFor={dateInputId}>
            {t('dashDateLabel')}
            <input
              id={dateInputId}
              type="date"
              className={styles.dateInput}
              value={date ?? ''}
              max={todayLocal()}
              onChange={(event) => setDate(event.target.value || null)}
            />
          </label>
        </div>
      </div>

      {query.isPending ? <p className={styles.empty}>{t('loading')}</p> : null}
      {query.isError ? <p className={styles.err}>{t('loadFailed')}</p> : null}

      {query.data ? <Report data={query.data} /> : null}

      <TrafficQualityCheck />
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

  const dateLabel = (value: string) =>
    format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: 'medium' });

  return (
    <>
      <p className={styles.rangeHint}>
        {data.from === data.to
          ? t('dashRangeSingle', { date: dateLabel(data.from) })
          : t('dashRangeFromTo', { from: dateLabel(data.from), to: dateLabel(data.to) })}
      </p>

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

/**
 * Проверка качества трафика за один день — по кнопке, не при открытии
 * страницы: сканирует сырые `AnalyticsSession`/`ProfileEvent`, а не
 * роллапы, и дорога в 90 раз сильнее, чем остальной дашборд. Выросла из
 * разбора конкретной подозрительной кампании вручную по SQL — здесь то же
 * самое, но без доступа к базе напрямую.
 */
function TrafficQualityCheck() {
  const t = useTranslations('analytics');
  const dateInputId = useId();
  const campaignInputId = useId();

  const [dateInput, setDateInput] = useState('');
  const [campaignInput, setCampaignInput] = useState('');
  const [submitted, setSubmitted] = useState<{ date: string; utmCampaign?: string } | null>(null);

  const query = useQuery({
    queryKey: queryKeys.trafficQuality(submitted?.date ?? '', submitted?.utmCampaign),
    queryFn: () => fetchTrafficQuality(submitted ?? { date: '' }),
    enabled: submitted !== null,
    staleTime: 60 * 1000,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!dateInput) return;
    setSubmitted({ date: dateInput, utmCampaign: campaignInput.trim() || undefined });
  };

  return (
    <section className={styles.block}>
      <h2 className={styles.blockTitle}>{t('tqTitle')}</h2>
      <p className={styles.hint}>{t('tqHint')}</p>

      <form className={styles.tqForm} onSubmit={onSubmit}>
        <label className={styles.dateField} htmlFor={dateInputId}>
          {t('tqDateLabel')}
          <input
            id={dateInputId}
            type="date"
            className={styles.dateInput}
            value={dateInput}
            max={todayLocal()}
            onChange={(event) => setDateInput(event.target.value)}
            required
          />
        </label>
        <label className={styles.dateField} htmlFor={campaignInputId}>
          {t('tqCampaignLabel')}
          <input
            id={campaignInputId}
            type="text"
            className={styles.dateInput}
            value={campaignInput}
            placeholder={t('tqCampaignPlaceholder')}
            onChange={(event) => setCampaignInput(event.target.value)}
          />
        </label>
        <button type="submit" className={styles.tqSubmit} disabled={!dateInput}>
          {t('tqSubmit')}
        </button>
      </form>

      {submitted === null ? <p className={styles.muted}>{t('tqPickDate')}</p> : null}
      {query.isFetching ? <p className={styles.empty}>{t('loading')}</p> : null}
      {query.isError ? <p className={styles.err}>{t('tqFailed')}</p> : null}
      {query.data ? <TrafficQualityReport data={query.data} /> : null}
    </section>
  );
}

function TrafficQualityReport({ data }: { data: TrafficQuality }) {
  const t = useTranslations('analytics');
  const format = useFormatter();

  return (
    <div className={styles.tqResult}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.num}>
                {t('tqColSessions')}
              </th>
              <th scope="col" className={styles.num}>
                {t('tqColDistinctVisitors')}
              </th>
              <th scope="col" className={styles.num}>
                {t('tqColSessionsPerVisitor')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.num}>{format.number(data.sessions)}</td>
              <td className={styles.num}>{format.number(data.distinctVisitors)}</td>
              <td className={styles.num}>
                {data.sessionsPerVisitor === null
                  ? '—'
                  : format.number(data.sessionsPerVisitor, { maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className={styles.tqSubTitle}>{t('tqTopVisitorsTitle')}</h3>
      {data.topVisitors.length === 0 ? (
        <p className={styles.muted}>{t('dashEmpty')}</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('tqColVisitor')}</th>
                <th scope="col">{t('tqColDevice')}</th>
                <th scope="col" className={styles.num}>
                  {t('tqColSessions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.topVisitors.map((row) => (
                <tr key={`${row.visitorHash}:${row.deviceType ?? 'unknown'}`}>
                  <th scope="row">{row.visitorHash}</th>
                  <td>{row.deviceType ?? '—'}</td>
                  <td className={styles.num}>{format.number(row.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className={styles.tqSubTitle}>{t('tqSilentTitle')}</h3>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.num}>
                {t('tqColSilentCount')}
              </th>
              <th scope="col" className={styles.num}>
                {t('tqColSilentPct')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.num}>{format.number(data.sessionsWithoutEvents)}</td>
              <td className={styles.num}>
                {data.sessionsWithoutEventsPct === null
                  ? '—'
                  : format.number(data.sessionsWithoutEventsPct / 100, {
                      style: 'percent',
                      maximumFractionDigits: 1,
                    })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className={styles.tqSubTitle}>{t('tqFunnelTitle')}</h3>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.num}>
                {t('tqColActiveSessions')}
              </th>
              <th scope="col" className={styles.num}>
                {t('tqColViews')}
              </th>
              <th scope="col" className={styles.num}>
                {t('tqColContacts')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.num}>{format.number(data.funnelSessionsWithActivity)}</td>
              <td className={styles.num}>{format.number(data.funnelViews)}</td>
              <td className={styles.num}>{format.number(data.funnelContacts)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className={styles.tqSubTitle}>{t('tqArrivalsTitle')}</h3>
      {data.arrivals.length === 0 ? (
        <p className={styles.muted}>{t('dashEmpty')}</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('tqColBucket')}</th>
                <th scope="col" className={styles.num}>
                  {t('tqColSessions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.arrivals.map((row) => (
                <tr key={row.bucket}>
                  <th scope="row">{row.bucket}</th>
                  <td className={styles.num}>{format.number(row.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
