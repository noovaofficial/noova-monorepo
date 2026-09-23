'use client';

import {
  type AdvertiserKind,
  OVERVIEW_PERIODS,
  type Overview,
  type OverviewKindStats,
  type OverviewPeriod,
  type OverviewQuery,
  type OverviewSort,
} from '@noova/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { DailyChart } from '@/modules/analytics/components/DailyChart';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchOverview } from '@/modules/moderation/api';
import { fillSeries } from '@/modules/moderation/overview-chart';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './AdvertiserOverview.module.css';

const PAGE_SIZE = 50;
const KINDS: AdvertiserKind[] = ['agency', 'individual', 'salon'];

/**
 * Обзор рекламодателей (только админ): кто самый ценный, сводка по типам,
 * динамика оплат и таблица с сортировкой. Ценность — оплаченные €: без бонуса
 * пополнения, подарков и корректировок.
 */
export function AdvertiserOverview() {
  const t = useTranslations('analytics');
  const { user, status } = useSession();
  const router = useRouter();
  const isAdmin = user?.role === 'admin';

  const [period, setPeriod] = useState<OverviewPeriod>('d30');
  const [kind, setKind] = useState<AdvertiserKind | undefined>(undefined);
  const [sort, setSort] = useState<OverviewSort>('paid');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);

  const query: OverviewQuery = { period, kind, sort, dir, limit: PAGE_SIZE, offset };
  const overview = useQuery({
    queryKey: queryKeys.overview(query),
    queryFn: () => fetchOverview(query),
    enabled: status === 'authenticated' && isAdmin,
    // Пока подгружается новая страница или сортировка, прежняя таблица остаётся на месте.
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;
  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }
  if (!isAdmin) return <p className={styles.empty}>{t('adminOnly')}</p>;

  const data = overview.data ?? null;

  const sortBy = (key: OverviewSort) => {
    if (sort === key) setDir(dir === 'desc' ? 'asc' : 'desc');
    else {
      setSort(key);
      setDir('desc');
    }
    setOffset(0);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('ovTitle')}</h1>
        {/* biome-ignore lint/a11y/useSemanticElements: группа переключателей, а не поле формы */}
        <div className={styles.periods} role="group" aria-label={t('periodLabel')}>
          {OVERVIEW_PERIODS.map((option) => (
            <button
              type="button"
              key={option}
              className={`${styles.period} ${period === option ? styles.periodSelected : ''}`}
              aria-pressed={period === option}
              onClick={() => {
                setPeriod(option);
                setOffset(0);
              }}
            >
              {t(`ovPeriod_${option}`)}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.lead}>{t('ovLead')}</p>

      {overview.isPending ? <p className={styles.empty}>{t('loading')}</p> : null}
      {overview.isError ? <p className={styles.err}>{t('loadFailed')}</p> : null}

      {data ? (
        <>
          <Totals data={data} />
          <Chart data={data} />
          <ByKind data={data} />
          <Table
            data={data}
            kind={kind}
            onKind={(next) => {
              setKind(next);
              setOffset(0);
            }}
            sort={sort}
            dir={dir}
            onSort={sortBy}
            offset={offset}
            onOffset={setOffset}
          />
        </>
      ) : null}
    </div>
  );
}

function useMoney() {
  const format = useFormatter();
  return {
    eur: (cents: number | null) =>
      cents === null ? '—' : format.number(cents / 100, { style: 'currency', currency: 'EUR' }),
    num: (value: number) => format.number(value),
  };
}

function Totals({ data }: { data: Overview }) {
  const t = useTranslations('analytics');
  const { eur, num } = useMoney();
  const { totals } = data;

  return (
    <>
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>{t('ovPaid')}</span>
          <span className={styles.cardValue}>{eur(totals.paidEurCents)}</span>
          {totals.changePct !== null ? (
            <span
              className={`${styles.cardHint} ${totals.changePct >= 0 ? styles.up : styles.down}`}
            >
              {t('ovVsPrev', {
                pct: `${totals.changePct > 0 ? '+' : ''}${totals.changePct}%`,
              })}
            </span>
          ) : null}
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>{t('ovTopups')}</span>
          <span className={styles.cardValue}>{num(totals.topupCount)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>{t('ovPaying')}</span>
          <span className={styles.cardValue}>{num(totals.payingAdvertisers)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>{t('ovAvgCheck')}</span>
          <span className={styles.cardValue}>{eur(totals.avgCheckCents)}</span>
        </div>
      </div>
      <p className={styles.note}>{t('ovNote')}</p>
    </>
  );
}

function Chart({ data }: { data: Overview }) {
  const t = useTranslations('analytics');
  const { eur } = useMoney();
  const points = fillSeries(data.chart.points, data.chart.bucket, data.from, data.to);
  if (points.length === 0) return null;

  return (
    <section className={styles.block}>
      <h2 className={styles.blockTitle}>
        {t(data.chart.bucket === 'month' ? 'ovChartMonths' : 'ovChartDays')}
      </h2>
      <DailyChart
        label={t('ovChartLabel')}
        points={points}
        unit={data.chart.bucket}
        formatValue={(value) => eur(value)}
      />
    </section>
  );
}

function Split({ registered, anonymous }: { registered: number; anonymous: number }) {
  const t = useTranslations('analytics');
  const { num } = useMoney();
  return (
    <>
      {num(registered + anonymous)}
      <span className={styles.sub}>
        {t('ovRegistered')} {num(registered)} · {t('ovAnonymous')} {num(anonymous)}
      </span>
    </>
  );
}

function ByKind({ data }: { data: Overview }) {
  const t = useTranslations('analytics');
  const { eur, num } = useMoney();

  const ctr = (k: OverviewKindStats) => {
    const views = k.views.registered + k.views.anonymous;
    const clicks = k.contactClicks.registered + k.contactClicks.anonymous;
    return views > 0 ? `${Math.round((clicks / views) * 1000) / 10}%` : '—';
  };

  return (
    <section className={styles.block}>
      <h2 className={styles.blockTitle}>{t('ovByKindTitle')}</h2>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('ovColType')}</th>
              <th scope="col" className={styles.num}>
                {t('ovColAdvertisers')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColPaying')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColProfiles')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColPaid')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColShare')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColPerAdvertiser')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColPerProfile')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColViews')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColClicks')}
              </th>
              <th scope="col" className={styles.num}>
                {t('ovColConversion')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byKind.map((k) => (
              <tr key={k.kind}>
                <th scope="row">{t(`ovKind_${k.kind}`)}</th>
                <td className={styles.num}>{num(k.advertisers)}</td>
                <td className={styles.num}>{num(k.payingAdvertisers)}</td>
                <td className={styles.num}>
                  {num(k.profiles)}
                  <span className={styles.sub}>
                    {t('ovPublishedCount', { count: k.publishedProfiles })}
                  </span>
                </td>
                <td className={styles.num}>{eur(k.paidEurCents)}</td>
                <td className={styles.num}>{k.sharePct}%</td>
                <td className={styles.num}>{eur(k.eurPerAdvertiserCents)}</td>
                <td className={styles.num}>{eur(k.eurPerPublishedCents)}</td>
                <td className={styles.num}>
                  <Split {...k.views} />
                </td>
                <td className={styles.num}>
                  <Split {...k.contactClicks} />
                </td>
                <td className={styles.num}>{ctr(k)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type TableProps = {
  data: Overview;
  kind: AdvertiserKind | undefined;
  onKind: (kind: AdvertiserKind | undefined) => void;
  sort: OverviewSort;
  dir: 'asc' | 'desc';
  onSort: (key: OverviewSort) => void;
  offset: number;
  onOffset: (offset: number) => void;
};

function Table({ data, kind, onKind, sort, dir, onSort, offset, onOffset }: TableProps) {
  const t = useTranslations('analytics');
  const { eur, num } = useMoney();

  const header = (key: OverviewSort, label: string) => (
    <th
      scope="col"
      className={styles.num}
      aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={styles.sortBtn} onClick={() => onSort(key)}>
        {label}
        {sort === key ? <span aria-hidden="true">{dir === 'asc' ? ' ↑' : ' ↓'}</span> : null}
      </button>
    </th>
  );

  const from = data.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + data.rows.length, data.total);

  return (
    <section className={styles.block}>
      <div className={styles.tableHead}>
        <h2 className={styles.blockTitle}>{t('ovTableTitle')}</h2>
        {/* biome-ignore lint/a11y/useSemanticElements: группа переключателей, а не поле формы */}
        <div className={styles.periods} role="group" aria-label={t('ovColType')}>
          {[undefined, ...KINDS].map((option) => (
            <button
              type="button"
              key={option ?? 'all'}
              className={`${styles.period} ${kind === option ? styles.periodSelected : ''}`}
              aria-pressed={kind === option}
              onClick={() => onKind(option)}
            >
              {option ? t(`ovKind_${option}`) : t('ovFilterAll')}
            </button>
          ))}
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className={styles.muted}>{t('ovEmpty')}</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('ovColAdvertiser')}</th>
                <th scope="col">{t('ovColType')}</th>
                {header('profiles', t('ovColProfiles'))}
                {header('paid', t('ovColPaid'))}
                {header('views', t('ovColViews'))}
                {header('clicks', t('ovColClicks'))}
                {header('eurPerProfile', t('ovColPerProfile'))}
                {header('eurPerClick', t('ovColPerClick'))}
                <th scope="col" className={styles.num}>
                  {t('ovColGifted')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.userId}>
                  <td className={styles.who}>
                    <Link href={`/admin/advertisers/${row.userId}/analytics`}>
                      {row.name ? (
                        <>
                          {row.name}
                          <span className={styles.email}> | {row.email}</span>
                        </>
                      ) : (
                        row.email
                      )}
                    </Link>
                  </td>
                  <td>{t(`ovKind_${row.kind}`)}</td>
                  <td className={styles.num}>
                    {num(row.profiles)}
                    <span className={styles.sub}>
                      {t('ovPublishedCount', { count: row.publishedProfiles })}
                    </span>
                  </td>
                  <td className={styles.num}>{eur(row.paidEurCents)}</td>
                  <td className={styles.num}>{num(row.views)}</td>
                  <td className={styles.num}>{num(row.contactClicks)}</td>
                  <td className={styles.num}>{eur(row.eurPerPublishedCents)}</td>
                  <td className={styles.num}>{eur(row.eurPerClickCents)}</td>
                  <td className={styles.num}>{num(row.giftedGc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.pager}>
        <span className={styles.muted}>{t('ovPageOf', { from, to, total: data.total })}</span>
        <div className={styles.pagerBtns}>
          <button
            type="button"
            className={styles.period}
            disabled={offset === 0}
            onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {t('ovPrev')}
          </button>
          <button
            type="button"
            className={styles.period}
            disabled={offset + PAGE_SIZE >= data.total}
            onClick={() => onOffset(offset + PAGE_SIZE)}
          >
            {t('ovNext')}
          </button>
        </div>
      </div>
    </section>
  );
}
