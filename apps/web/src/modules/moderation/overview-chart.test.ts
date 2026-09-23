import { describe, expect, it } from 'vitest';
import { fillSeries } from './overview-chart';

describe('ряд оплат для графика', () => {
  it('дни без платежей — нулями, ряд подряд от начала до конца', () => {
    const series = fillSeries(
      [{ date: '2026-07-02', paidEurCents: 500 }],
      'day',
      '2026-07-01',
      '2026-07-04',
    );
    expect(series).toEqual([
      { date: '2026-07-01', value: 0 },
      { date: '2026-07-02', value: 500 },
      { date: '2026-07-03', value: 0 },
      { date: '2026-07-04', value: 0 },
    ]);
  });

  it('за всё время — помесячно от первого платежа до текущего месяца', () => {
    const series = fillSeries(
      [{ date: '2026-05', paidEurCents: 100 }],
      'month',
      null,
      '2026-07-15',
    );
    expect(series.map((p) => p.date)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(series[0]?.value).toBe(100);
  });

  it('нет платежей за всё время — пустой ряд', () => {
    expect(fillSeries([], 'month', null, '2026-07-15')).toEqual([]);
  });
});
