/**
 * Ряд оплат для графика без дыр: API отдаёт только дни (месяцы), в которые
 * были платежи, а график рисует ряд подряд — пропуск читался бы как «данных
 * нет», а не как «никто не платил».
 */
export type ChartPoint = { date: string; value: number };

const addDays = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

const addMonths = (month: string, count: number): string => {
  const at = new Date(`${month}-01T00:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() + count);
  return at.toISOString().slice(0, 7);
};

export function fillSeries(
  points: { date: string; paidEurCents: number }[],
  bucket: 'day' | 'month',
  from: string | null,
  to: string,
): ChartPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p.paidEurCents]));
  const step = bucket === 'day' ? addDays : addMonths;
  const end = bucket === 'day' ? to : to.slice(0, 7);
  const first = bucket === 'day' ? from : (points[0]?.date ?? null);
  if (!first) return [];

  const out: ChartPoint[] = [];
  for (let date = first; date <= end; date = step(date, 1)) {
    out.push({ date, value: byDate.get(date) ?? 0 });
  }
  return out;
}
