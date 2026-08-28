'use client';

import { useEffect, useRef } from 'react';
import styles from './AreaMap.module.css';

type Props = {
  lat: number;
  lng: number;
  /** Радиус области в метрах. Показываем область, а не точку. */
  radiusMeters?: number;
  note: string;
  attribution: string;
};

/**
 * Размер мозаики. Больше видимой области намеренно: карту можно протащить и
 * осмотреть окрестности, не поднимая библиотеку карт. Видимое окно задаёт CSS,
 * а прокрутка внутри него — обычная прокрутка блока.
 */
const COLS = 6;
const ROWS = 5;
const TILE = 256;
const ZOOM = 14;

/** Web Mercator: номер тайла по долготе. */
function lngToTile(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

/** Web Mercator: номер тайла по широте. */
function latToTile(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

/**
 * Карта района: мозаика статичных плиток и круг поверх неё.
 *
 * Без библиотеки карт намеренно: Leaflet и подобные весят сотню килобайт и
 * тянут рантайм на страницу, которая должна оставаться лёгкой и попадать
 * в индекс. Плитки грузятся лениво самим браузером, отношение сторон задано
 * заранее, поэтому разметка не дёргается.
 *
 * Прокрутка есть, масштабирования нет. Осмотреть окрестности посетителю
 * нужно — приблизить до дома нельзя: масштаб фиксирован, и круг остаётся
 * тем же приблизительным пятном на любом положении прокрутки. Ради одной
 * этой прокрутки компонент клиентский; разметка та же и приходит с сервера.
 *
 * **Показывается область, а не точка.** `approxLat`/`approxLng` уже огрублены
 * до центра района; круг поверх них говорит «где-то здесь» и не даёт
 * восстановить адрес. Маркера нет специально: булавка читается как точное
 * место, даже если координата приблизительная.
 */
export function AreaMap({ lat, lng, radiusMeters = 1000, note, attribution }: Props) {
  const centerX = lngToTile(lng, ZOOM);
  const centerY = latToTile(lat, ZOOM);

  // Левый верхний тайл мозаики: центр минус половина сетки.
  const originX = Math.floor(centerX - COLS / 2);
  const originY = Math.floor(centerY - ROWS / 2);

  const width = COLS * TILE;
  const height = ROWS * TILE;

  // Положение центра внутри мозаики, в пикселях.
  const offsetX = (centerX - originX) * TILE;
  const offsetY = (centerY - originY) * TILE;

  // Метры на пиксель на этой широте: масштаб Меркатора зависит от широты,
  // и без косинуса круг на севере вышел бы заметно больше нужного.
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM;
  const radiusPx = radiusMeters / metersPerPixel;

  const tiles = Array.from({ length: COLS * ROWS }, (_, index) => ({
    x: originX + (index % COLS),
    y: originY + Math.floor(index / COLS),
  }));

  const viewport = useRef<HTMLDivElement | null>(null);
  const centered = useRef(false);

  // Мозаика больше окна, и браузер показал бы её левый верхний угол — то есть
  // соседний район вместо нужного. Прокручиваем к центру.
  //
  // Через наблюдатель, а не сразу при монтировании: раздел с картой свёрнут
  // по умолчанию, а у скрытого элемента нет размеров, и считать по ним центр
  // нечего. Наблюдатель ловит момент раскрытия и тут же отключается, чтобы
  // не отменять прокрутку, сделанную посетителем.
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      if (centered.current || node.clientWidth === 0) return;
      centered.current = true;
      node.scrollLeft = offsetX - node.clientWidth / 2;
      node.scrollTop = offsetY - node.clientHeight / 2;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [offsetX, offsetY]);

  return (
    <div>
      {/* Окно прокрутки: мозаика шире и выше него, и её можно протащить
          мышью, пальцем или колесом. */}
      <div className={styles.frame}>
        <div className={styles.viewport} ref={viewport}>
          <div className={styles.wrap} style={{ width, height }}>
            <div className={styles.tiles} style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
              {tiles.map((tile) => (
                // Плитка уже 256×256 и отдаётся своим маршрутом с недельным кэшем:
                // оптимизатор Next добавил бы второй проксирующий слой без пользы.
                // biome-ignore lint/performance/noImgElement: см. выше
                <img
                  className={styles.tile}
                  key={`${tile.x}:${tile.y}`}
                  // Через собственный домен: прямой запрос к тайл-серверу сообщил
                  // бы ему адрес посетителя и то, какую анкету он смотрит.
                  src={`/api/map/${ZOOM}/${tile.x}/${tile.y}.png`}
                  alt=""
                  width={TILE}
                  height={TILE}
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>

            <svg
              className={styles.overlay}
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <circle className={styles.area} cx={offsetX} cy={offsetY} r={radiusPx} />
            </svg>
          </div>
        </div>

        {/* Подпись — соседка окна, а не его содержимое: внутри прокрутки она
            уехала бы вместе с картой и пропала из виду. */}
        <span className={styles.attribution}>{attribution}</span>
      </div>

      <p className={styles.note}>{note}</p>
    </div>
  );
}
