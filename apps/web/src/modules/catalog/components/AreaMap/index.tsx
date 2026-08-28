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

/** Стартовый вид: район целиком, дальше посетитель приближает сам. */
const START_ZOOM = 14;
const MAX_ZOOM = 18;

/**
 * Карта района на странице анкеты.
 *
 * Полноценная карта Leaflet — та же, что в кабинете у `LocationPicker`:
 * посетителю нужно и приблизить перекрёсток, и отойти, чтобы понять, далеко
 * ли ехать. Библиотека грузится динамическим импортом и только когда карту
 * открыли, так что на вес самой страницы анкеты она не влияет.
 *
 * **Показывается область, а не точка.** `approxLat`/`approxLng` уже огрублены
 * до узла сетки, и круг поверх них говорит «где-то здесь». Маркера нет
 * специально: булавка читается как точное место, даже если координата
 * приблизительная. Приближение ничего не выдаёт — на любом масштабе это тот
 * же круг вокруг того же огрублённого центра.
 */
export function AreaMap({ lat, lng, radiusMeters = 1000, note, attribution }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Leaflet императивен: держим ссылку и не пересоздаём карту на каждый рендер.
  const mapRef = useRef<{ remove: () => void; invalidateSize: () => void } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    void (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current || mapRef.current) return;

      // Управление стандартное, как у карты в кабинете: кнопки, колесо,
      // двойной щелчок, щипок на телефоне.
      const map = L.map(containerRef.current, { attributionControl: true }).setView(
        [lat, lng],
        START_ZOOM,
      );

      // Плитки через собственный домен: прямой запрос к тайл-серверу сообщил
      // бы ему адрес посетителя и то, какую анкету он смотрит.
      L.tileLayer('/tiles/{z}/{x}/{y}.png', {
        maxZoom: MAX_ZOOM,
        attribution,
      }).addTo(map);

      L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#c026d3',
        fillOpacity: 0.18,
        weight: 2,
      }).addTo(map);

      mapRef.current = map;

      // Раздел с картой свёрнут по умолчанию, а внутри `display: none`
      // у контейнера нет размеров — Leaflet посчитал бы их нулевыми и показал
      // серое поле. Пересчитываем, как только раздел раскроют.
      const observer = new ResizeObserver(() => {
        if (containerRef.current?.clientWidth) map.invalidateSize();
      });
      observer.observe(containerRef.current);
      map.once('remove', () => observer.disconnect());
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, radiusMeters, attribution]);

  return (
    <div>
      <div className={styles.map} ref={containerRef} />
      <p className={styles.note}>{note}</p>
    </div>
  );
}
