import { describe, expect, it } from 'vitest';
import { resolvePlacement } from './placement.js';

describe('resolvePlacement', () => {
  it('по умолчанию — платно и разрешено', () => {
    expect(resolvePlacement(null, null)).toEqual({ paid: true, allowed: true });
  });

  it('страна задаёт значение, если города нет', () => {
    expect(resolvePlacement(null, { paid: false, allowed: null })).toEqual({
      paid: false,
      allowed: true,
    });
  });

  it('город сильнее страны, каждое поле решается отдельно', () => {
    expect(
      resolvePlacement({ paid: true, allowed: null }, { paid: false, allowed: false }),
    ).toEqual({ paid: true, allowed: false });
  });
});
