/**
 * Сетка огрубления координат. 0.01° — это около 1.1 км по широте и около
 * 0.7 км по долготе на широте Берлина, то есть примерно та же величина,
 * что и радиус круга, который рисуется на карте.
 *
 * Смысл огрубления: владелица ставит точку сама, но хранить и отдавать
 * наружу мы обязаны нечто заведомо более грубое, чем её дом. Округление до
 * узла сетки делает соседние адреса неразличимыми — по сохранённому значению
 * нельзя понять, какой это подъезд, дом или даже квартал.
 */
export const LOCATION_GRID_DEGREES = 0.01;

/** Разумные пределы: за ними значение либо ошибка, либо не Земля. */
export const LAT_RANGE = [-85, 85] as const;
export const LNG_RANGE = [-180, 180] as const;

/**
 * Округляет координату до узла сетки. Вызывается **на сервере**: клиент
 * может показать результат заранее, но решает не он — иначе точное значение
 * доехало бы до базы, стоит только подделать запрос.
 */
export function snapToGrid(value: number, grid = LOCATION_GRID_DEGREES): number {
  // Через целые числа: 52.5244 / 0.01 в плавающей точке даёт 5252.439999,
  // и обычное умножение обратно тянет за собой хвост вроде 52.52000000000001.
  const steps = Math.round(value / grid);
  return Number((steps * grid).toFixed(6));
}

export type SnappedLocation = { lat: number; lng: number };

/**
 * Приводит пару координат к сетке. `null`, если значения вне разумных
 * пределов: подсунутая широта 900 не должна попадать в базу.
 */
export function snapLocation(lat: number, lng: number): SnappedLocation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) return null;
  if (lng < LNG_RANGE[0] || lng > LNG_RANGE[1]) return null;
  return { lat: snapToGrid(lat), lng: snapToGrid(lng) };
}
