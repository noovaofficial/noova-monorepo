import { canBuyProfileTop } from '@noova/shared';
import { describe, expect, it } from 'vitest';

describe('кому продаётся ТОП анкет', () => {
  it('индивидуалке и салону — всегда, флаг страны на них не влияет', () => {
    for (const flag of [true, false]) {
      expect(canBuyProfileTop('individual', flag)).toBe(true);
      expect(canBuyProfileTop('salon', flag)).toBe(true);
    }
  });

  it('агентству — только если страна разрешила', () => {
    expect(canBuyProfileTop('agency', false)).toBe(false);
    expect(canBuyProfileTop('agency', true)).toBe(true);
  });
});
