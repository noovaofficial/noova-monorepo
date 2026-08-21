import { describe, expect, it } from 'vitest';

/** Те же формулы, что в компоненте: проверяем математику отдельно от разметки. */
const lngToTile = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const latToTile = (lat: number, z: number) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};
const metersPerPixel = (lat: number, z: number) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

describe('расчёт плиток карты', () => {
  it('центр Берлина попадает в известный тайл', () => {
    // 52.52, 13.405 на z14 — тайл 8802/5373 по общей схеме Web Mercator.
    expect(Math.floor(lngToTile(13.405, 14))).toBe(8802);
    expect(Math.floor(latToTile(52.52, 14))).toBe(5373);
  });

  it('нулевой меридиан и экватор дают середину сетки', () => {
    expect(lngToTile(0, 14)).toBe(2 ** 13);
    expect(latToTile(0, 14)).toBeCloseTo(2 ** 13, 6);
  });

  it('масштаб зависит от широты', () => {
    // Без косинуса круг в 1 км на широте Берлина вышел бы в полтора раза
    // больше нужного: метр на экваторе и на 52-й параллели — разное число
    // пикселей.
    const berlin = metersPerPixel(52.52, 14);
    const equator = metersPerPixel(0, 14);
    expect(berlin).toBeLessThan(equator);
    expect(berlin / equator).toBeCloseTo(Math.cos((52.52 * Math.PI) / 180), 6);
  });

  it('радиус в 1 км укладывается в мозаику 3×2', () => {
    // Мозаика 768×512 пикселей; круг диаметром больше высоты вылез бы
    // за карту и перестал читаться как область.
    const radiusPx = 1000 / metersPerPixel(52.52, 14);
    expect(radiusPx * 2).toBeLessThan(512);
  });
});
