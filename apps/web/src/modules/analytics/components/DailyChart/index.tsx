'use client';

import { useFormatter } from 'next-intl';
import styles from './DailyChart.module.css';

type Props = {
  /** Дни подряд, включая пустые. Пустые дни рисуются нулём, а не пропуском. */
  points: { date: string; value: number }[];
  /** Что именно показано — уходит в подпись графика для чтения с экрана. */
  label: string;
};

/** Столбики рисуются в этой системе координат и растягиваются по месту. */
const VIEW_HEIGHT = 120;

/**
 * Дневной ряд одной метрики.
 *
 * Столбики, а не линия: значения дискретны — это «сколько раз за сутки», а
 * не непрерывная величина, и линия между двумя днями рисовала бы значения,
 * которых не было. Собственный SVG, а не библиотека графиков: одному
 * столбчатому ряду не нужны ни оси со шкалами, ни зум, ни легенда, а
 * ближайшая библиотека весит больше всего кабинета вместе взятого.
 *
 * Одна метрика за раз: у просмотров и кликов разница на порядок, и на общей
 * шкале клики превратились бы в ровную линию по нулю.
 */
export function DailyChart({ points, label }: Props) {
  const format = useFormatter();

  // Пустой ряд невозможен — период всегда хотя бы неделя, — но рисовать
  // «график ни из чего» всё равно нечем, и `points[0]` ниже без этого лжёт.
  if (points.length === 0) return null;

  const max = Math.max(...points.map((point) => point.value), 1);

  // Ширина столбика в процентах, чтобы график тянулся по контейнеру.
  const step = 100 / points.length;
  // Зазор между столбиками. На девяноста днях он съедает столбик целиком,
  // поэтому доля от шага, а не фиксированные пиксели.
  const gap = Math.min(step * 0.25, 0.6);

  const dayLabel = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), { day: 'numeric', month: 'short' });

  return (
    <figure className={styles.wrap}>
      <div className={styles.plot}>
        {/* Верхняя засечка — максимум ряда: без неё высота столбика ничего
            не говорит, а полноценные оси на семи днях только шумят. */}
        <span className={styles.axisMax}>{format.number(max)}</span>

        <svg
          className={styles.svg}
          viewBox={`0 0 100 ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
        >
          {points.map((point, index) => {
            // Ненулевой день должен быть виден и при значении в единицу
            // против тысячи: иначе «был один звонок» и «звонков не было»
            // выглядят одинаково.
            const height = point.value === 0 ? 0 : Math.max((point.value / max) * VIEW_HEIGHT, 2);
            return (
              <rect
                key={point.date}
                x={index * step + gap / 2}
                y={VIEW_HEIGHT - height}
                width={step - gap}
                height={height}
                rx={0.4}
                className={point.value === 0 ? styles.barEmpty : styles.bar}
              >
                <title>{`${dayLabel(point.date)}: ${format.number(point.value)}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>

      {/* Только края ряда: подписать каждый из девяноста дней негде, а первая
          и последняя дата отвечают на единственный вопрос к оси — какой
          отрезок времени перед глазами. */}
      <figcaption className={styles.axis}>
        <span>{dayLabel((points[0] as { date: string }).date)}</span>
        <span>{dayLabel((points[points.length - 1] as { date: string }).date)}</span>
      </figcaption>
    </figure>
  );
}
