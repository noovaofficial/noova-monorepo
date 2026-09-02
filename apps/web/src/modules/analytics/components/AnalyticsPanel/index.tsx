'use client';

import {
  ANALYTICS_METRICS,
  ANALYTICS_PERIODS,
  type Analytics,
  type AnalyticsMetric,
  type AnalyticsPeriod,
  CONTACT_TYPES,
} from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { fetchAnalytics } from '@/modules/analytics/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { DailyChart } from '../DailyChart';
import styles from './Analytics.module.css';

export function AnalyticsPanel() {
  const t = useTranslations('analytics');
  const tc = useTranslations('contacts');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();

  const [period, setPeriod] = useState<AnalyticsPeriod>('d30');
  // Метрика графика выбирается той же карточкой, что показывает её итог:
  // отдельный список под карточками дублировал бы их подписи.
  const [metric, setMetric] = useState<AnalyticsMetric>('views');

  const isAdvertiser = user?.role === 'advertiser';
  const analytics = useQuery({
    queryKey: queryKeys.analytics(period),
    queryFn: () => fetchAnalytics(period),
    enabled: isAdvertiser,
    // Отчёт меняется медленно, а переключение периодов туда-обратно —
    // самое частое движение на этой странице.
    staleTime: 60 * 1000,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdvertiser) return <p className={styles.empty}>{t('onlyAdvertisers')}</p>;

  const data = analytics.data ?? null;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>

        {/* biome-ignore lint/a11y/useSemanticElements: группа переключателей, а не поля формы — <fieldset> принёс бы сюда рамку и семантику ввода */}
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

      {analytics.isPending ? <p className={styles.empty}>{t('loading')}</p> : null}
      {analytics.isError ? <p className={styles.err}>{t('loadFailed')}</p> : null}

      {data ? (
        <>
          <div className={styles.cards}>
            {ANALYTICS_METRICS.map((key) => (
              <MetricCard
                key={key}
                metric={key}
                data={data}
                selected={metric === key}
                onSelect={() => setMetric(key)}
              />
            ))}
          </div>

          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>{t(`metric_${metric}`)}</h2>
            <p className={styles.hint}>
              {t('rangeHint', {
                from: format.dateTime(new Date(`${data.from}T12:00:00Z`), { dateStyle: 'medium' }),
                to: format.dateTime(new Date(`${data.to}T12:00:00Z`), { dateStyle: 'medium' }),
              })}
            </p>
            <DailyChart
              label={t('chartLabel', { metric: t(`metric_${metric}`) })}
              points={data.series.map((point) => ({ date: point.date, value: point[metric] }))}
            />
          </section>

          {/* Каналы — ответ на вопрос «какой контакт держать первым»: если
              по телефону не звонит никто, а в WhatsApp пишут все, порядок
              контактов в анкете стоит поменять. */}
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>{t('contactsTitle')}</h2>
            {data.totals.contactClicks.total === 0 ? (
              <p className={styles.hint}>{t('contactsEmpty')}</p>
            ) : (
              <ul className={styles.channels}>
                {CONTACT_TYPES.map((type) => {
                  const row = data.contacts.find((item) => item.type === type);
                  const clicks = row?.clicks ?? 0;
                  const share = Math.round((clicks / data.totals.contactClicks.total) * 100);
                  return (
                    <li className={styles.channel} key={type}>
                      <span className={styles.channelName}>{tc(type)}</span>
                      <span className={styles.channelBar} aria-hidden="true">
                        <span className={styles.channelFill} style={{ width: `${share}%` }} />
                      </span>
                      <span className={styles.channelValue}>
                        {format.number(clicks)}
                        <span className={styles.channelShare}> · {share}%</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Разбивка приходит только у агентства: у индивидуалки и салона
              анкета одна, и таблица повторяла бы карточки итогов. */}
          {data.profiles.length > 0 ? (
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>{t('profilesTitle')}</h2>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('columnProfile')}</th>
                      {ANALYTICS_METRICS.map((key) => (
                        <th scope="col" className={styles.numCell} key={key}>
                          {t(`metricShort_${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.profiles.map((row) => (
                      <tr key={row.profileId}>
                        <th scope="row" className={styles.nameCell}>
                          {row.displayName}
                        </th>
                        {ANALYTICS_METRICS.map((key) => (
                          <td className={styles.numCell} key={key}>
                            {format.number(row[key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className={styles.note}>{t('note')}</p>
        </>
      ) : null}
    </div>
  );
}

type CardProps = {
  metric: AnalyticsMetric;
  data: Analytics;
  selected: boolean;
  onSelect: () => void;
};

/**
 * Карточка итога. Она же переключатель графика — поэтому кнопка, а не блок
 * с текстом: нажимаемое должно и выглядеть, и озвучиваться нажимаемым.
 *
 * Доли между ступенями («45% от показов») здесь были и убраны: клик по
 * двум каналам после одного показа даёт больше ста процентов, и цифра
 * читается поломкой, а не конверсией. Отношения ступеней видны и так —
 * карточки стоят рядом в порядке воронки.
 */
function MetricCard({ metric, data, selected, onSelect }: CardProps) {
  const t = useTranslations('analytics');
  const format = useFormatter();

  const split = data.totals[metric];

  return (
    <button
      type="button"
      className={`${styles.metric} ${selected ? styles.metricSelected : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.metricName}>{t(`metric_${metric}`)}</span>
      <span className={styles.metricValue}>{format.number(split.total)}</span>

      {/* У избранного разбивки нет по устройству функции: отметить анкету
          может только вошедший клиент, гостевых добавлений не бывает. */}
      {metric === 'favorites' ? null : (
        <span className={styles.metricSplit}>
          {t('splitRegistered', { count: split.registered })}
          {' · '}
          {t('splitAnonymous', { count: split.anonymous })}
        </span>
      )}
    </button>
  );
}
