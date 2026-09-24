/**
 * Шкала столбчатого графика: «круглый» верх оси и выбор подписей.
 * Вынесено из компонента, чтобы правила проверялись тестом без разметки.
 */

/** Ближайшее сверху «круглое» число вида 1/2/5 × 10^k: 37 -> 50, 120 -> 200. */
export function niceCeil(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

/** Сколько столбиков ещё можно подписать значением над каждым. */
export const MAX_LABELED_BARS = 16;

/** Целевое число подписей дат под осью. */
const TARGET_TICKS = 7;

/**
 * Индексы столбиков, под которыми стоит дата. Равномерно, начиная с первого:
 * подписать каждый из девяноста дней негде, а первая-последняя дата не
 * говорят, какой это день посередине.
 */
export function tickIndexes(count: number): number[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(count / TARGET_TICKS));
  const indexes: number[] = [];
  for (let i = 0; i < count; i += step) indexes.push(i);
  return indexes;
}
