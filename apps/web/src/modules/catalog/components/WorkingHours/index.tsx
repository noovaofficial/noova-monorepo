import type { SalonHours } from '@noova/shared';
import { getTranslations } from 'next-intl/server';
import styles from './WorkingHours.module.css';

/** Минуты от полуночи в «10:00». Разделитель без учёта локали: время суток
 *  во всех трёх языках пишется одинаково. */
function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Часы работы салона (N-34).
 *
 * Показываем всю неделю, а не только сегодня: посетитель планирует визит, и
 * «сегодня закрыто» без остального расписания не отвечает на его вопрос.
 * День, которого нет в данных, — выходной: салон заполняет только рабочие.
 */
export async function WorkingHours({ hours, locale }: { hours: SalonHours[]; locale: string }) {
  if (hours.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'company' });
  const byWeekday = new Map(hours.map((h) => [h.weekday, h]));

  // Порядок недели фиксированный, с понедельника: в данных дни могут идти
  // как угодно, а читается расписание только подряд.
  const week = [1, 2, 3, 4, 5, 6, 7] as const;
  const today = new Date().getDay() || 7;

  return (
    // Заголовок даёт секция снаружи: часы стоят в том же ряду блоков, что
    // контакты и тарифы, и второй заголовок внутри дублировал бы её.
    <dl className={styles.list}>
      {week.map((weekday) => {
        const day = byWeekday.get(weekday);
        // Сужаем здесь, а не в разметке: контракт гарантирует, что поля
        // заполнены парой, но тип этого не знает.
        const open =
          day?.opensAt != null && day.closesAt != null
            ? { opensAt: day.opensAt, closesAt: day.closesAt }
            : null;
        return (
          <div className={`${styles.row} ${weekday === today ? styles.today : ''}`} key={weekday}>
            <dt className={styles.day}>{t(`weekday_${weekday}`)}</dt>
            <dd className={open ? styles.time : styles.closed}>
              {open ? `${hhmm(open.opensAt)} — ${hhmm(open.closesAt)}` : t('dayOff')}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
