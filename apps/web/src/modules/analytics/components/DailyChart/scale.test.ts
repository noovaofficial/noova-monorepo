import { describe, expect, it } from 'vitest';
import { niceCeil, tickIndexes } from './scale';

describe('шкала графика', () => {
  it('верх оси — круглое число сверху', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(37)).toBe(50);
    expect(niceCeil(50)).toBe(50);
    expect(niceCeil(51)).toBe(100);
    expect(niceCeil(120)).toBe(200);
    expect(niceCeil(25001)).toBe(50000);
  });

  it('подписи дат: неделя — каждый день, три месяца — семь-восемь меток', () => {
    expect(tickIndexes(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(tickIndexes(30)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(tickIndexes(90).length).toBeLessThanOrEqual(8);
    expect(tickIndexes(90)[0]).toBe(0);
    expect(tickIndexes(0)).toEqual([]);
  });
});
