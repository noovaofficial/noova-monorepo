import { describe, expect, it } from 'vitest';
import { LOCATION_GRID_DEGREES, snapLocation, snapToGrid } from './geo';

describe('огрубление координат', () => {
  it('точки внутри одной ячейки неразличимы', () => {
    // Настоящая гарантия огрубления: всё, что попало в одну ячейку сетки,
    // сохраняется одинаково — по значению нельзя понять, какой это дом.
    // Точки по разные стороны границы ячейки при этом разойдутся: сетка
    // прячет положение внутри километра, а не «сливает всех соседей».
    expect(snapLocation(52.5241, 13.4102)).toEqual(snapLocation(52.5238, 13.4139));
  });

  it('сохранённое значение отстоит от исходного не больше чем на полшага', () => {
    // Это и есть предел точности, который доезжает до базы.
    for (const lat of [52.5001, 52.5049, 52.5099, 52.4812]) {
      const snapped = snapToGrid(lat);
      expect(Math.abs(snapped - lat)).toBeLessThanOrEqual(LOCATION_GRID_DEGREES / 2 + 1e-9);
    }
  });

  it('точки в разных районах остаются разными', () => {
    // Огрубление не должно стирать смысл: Kreuzberg и Prenzlauer Berg
    // обязаны отличаться, иначе карта перестаёт что-либо сообщать.
    expect(snapLocation(52.498, 13.403)).not.toEqual(snapLocation(52.539, 13.424));
  });

  it('не оставляет хвостов плавающей точки', () => {
    // 52.5244 / 0.01 даёт 5252.439999… — наивное умножение обратно
    // возвращало бы 52.52000000000001 и мусор в базе.
    expect(snapToGrid(52.5244)).toBe(52.52);
    expect(snapToGrid(13.4105)).toBe(13.41);
    expect(String(snapToGrid(52.5244))).not.toContain('000000');
  });

  it('шаг сетки сопоставим с радиусом круга на карте', () => {
    // Круг рисуется радиусом километр; если бы сетка была заметно мельче,
    // огрубление ничего не защищало бы — точка читалась бы внутри круга.
    const metersPerDegreeLat = 111_320;
    expect(LOCATION_GRID_DEGREES * metersPerDegreeLat).toBeGreaterThan(1000);
  });

  it('отвергает значения вне Земли', () => {
    expect(snapLocation(900, 13.4)).toBeNull();
    expect(snapLocation(52.5, 500)).toBeNull();
    expect(snapLocation(Number.NaN, 13.4)).toBeNull();
  });
});
