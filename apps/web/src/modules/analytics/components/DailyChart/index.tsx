'use client';

import { useFormatter } from 'next-intl';
import styles from './DailyChart.module.css';
import { MAX_LABELED_BARS, niceCeil, tickIndexes } from './scale';

type Props = {
  /** Дни подряд, включая пустые. Пустые дни рисуются нулём, а не пропуском. */
  points: { date: string; value: number }[];
  /** Что именно показано — уходит в подпись графика для чтения с экрана. */
  label: string;
  /** Шаг ряда: сутки (`YYYY-MM-DD`) или месяц (`YYYY-MM`). По умолчанию сутки. */
  unit?: 'day' | 'month';
  /** Как показать значение в подсказке, на оси и над столбиком; по умолчанию число. */
  formatValue?: (value: number) => string;
};

/**
 * Ряд одной метрики: столбики с шкалой слева, датами снизу и значением над
 * столбиком.
 *
 * Собственная разметка, а не библиотека графиков: одному столбчатому ряду не
 * нужны ни зум, ни легенда, а ближайшая библиотека весит больше всего
 * кабинета вместе взятого. Столбики — HTML, а не SVG с растяжением: текст в
 * растянутом SVG искажается.
 *
 * - Ось: верх — «круглое» число (1/2/5 × 10^k), подписаны верх, середина и
 *   ноль, по ним проведены линии.
 * - Даты: равномерно под столбиками (`tickIndexes`), не только края.
 * - Значения: над каждым столбиком, если их немного; иначе только над
 *   самым высоким, остальные — в подсказке при наведении.
 *
 * Одна метрика за раз: у просмотров и кликов разница на порядок, и на общей
 * шкале клики превратились бы в ровную линию по нулю.
 */
export function DailyChart({ points, label, unit = 'day', formatValue }: Props) {
  const format = useFormatter();
  const valueLabel =
    formatValue ??
    ((value: number) => format.number(value, { notation: 'compact', maximumFractionDigits: 1 }));

  // Пустой ряд невозможен — период всегда хотя бы неделя, — но рисовать
  // «график ни из чего» всё равно нечем.
  if (points.length === 0) return null;

  const peak = Math.max(...points.map((point) => point.value), 0);
  const top = niceCeil(peak);
  const labelAll = points.length <= MAX_LABELED_BARS;
  const peakIndex = points.findIndex((point) => point.value === peak);
  const ticks = new Set(tickIndexes(points.length));

  const dateLabel = (date: string, short = true) =>
    unit === 'month'
      ? format.dateTime(new Date(`${date}-01T12:00:00Z`), { month: 'short', year: '2-digit' })
      : format.dateTime(new Date(`${date}T12:00:00Z`), {
          day: 'numeric',
          month: short ? 'short' : 'long',
        });

  const columns = { gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` };

  return (
    <figure className={styles.wrap}>
      <div className={styles.chart}>
        <div className={styles.yAxis} aria-hidden="true">
          <span>{valueLabel(top)}</span>
          <span>{valueLabel(top / 2)}</span>
          <span>0</span>
        </div>

        <div className={styles.area}>
          <div className={styles.grid} aria-hidden="true">
            <span />
            <span />
          </div>

          <div className={styles.bars} style={columns} role="img" aria-label={label}>
            {points.map((point, index) => {
              const height = point.value === 0 ? 0 : Math.max((point.value / top) * 100, 1.5);
              const showValue = point.value > 0 && (labelAll || index === peakIndex);
              return (
                <div
                  key={point.date}
                  className={styles.col}
                  title={`${dateLabel(point.date, false)}: ${valueLabel(point.value)}`}
                >
                  {showValue ? (
                    <span className={styles.value}>{valueLabel(point.value)}</span>
                  ) : null}
                  <span className={styles.bar} style={{ height: `${height}%` }} />
                </div>
              );
            })}
          </div>

          <div className={styles.xAxis} style={columns} aria-hidden="true">
            {points.map((point, index) => (
              <span key={point.date} className={styles.tick}>
                {ticks.has(index) ? dateLabel(point.date) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
