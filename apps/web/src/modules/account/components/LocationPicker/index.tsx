'use client';

import { LOCATION_GRID_DEGREES, snapLocation } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import styles from './LocationPicker.module.css';

type Location = { lat: number; lng: number };

type Props = {
  /** Текущая точка. Null — координаты выводятся из района. */
  value: Location | null;
  onChange: (next: Location | null) => void;
  /** Куда смотреть, когда точки ещё нет: центр района или города. */
  fallback: Location;
  /** Радиус круга в метрах — тот же, что виден посетителю. */
  radiusMeters?: number;
};

/**
 * Выбор места на карте. Живёт только в кабинете, за формой входа: сюда
 * подключается Leaflet, и его сотня килобайт сюда допустима — в отличие от
 * публичной страницы анкеты, где карта нарисована статичной мозаикой без
 * единой библиотеки.
 *
 * **Показываем не саму точку, а круг после огрубления.** Владелица должна
 * видеть ровно то, что увидит посетитель: если рисовать маркер там, куда она
 * ткнула, возникнет ложное ощущение, что мы храним точный адрес. Сервер
 * всё равно округлит значение до узла сетки (`snapLocation`), и круг
 * рисуется уже вокруг округлённого.
 */
export function LocationPicker({ value, onChange, fallback, radiusMeters = 1000 }: Props) {
  const t = useTranslations('account');
  const containerRef = useRef<HTMLDivElement>(null);
  // Держим ссылки на карту и круг: Leaflet — императивная библиотека,
  // и пересоздавать её на каждый рендер нельзя.
  const mapRef = useRef<{ remove: () => void } | null>(null);
  const circleRef = useRef<{ setLatLng: (v: Location) => void } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    // Динамический импорт: библиотека не должна попадать в общий бандл
    // и грузиться тем, кто карту не открывал.
    void (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      const start = value ?? fallback;
      const map = L.map(containerRef.current, { attributionControl: true }).setView(
        [start.lat, start.lng],
        14,
      );

      // Плитки через собственный домен: прямой запрос к тайл-серверу сообщил
      // бы ему адрес владелицы и то, какой участок она разглядывает.
      L.tileLayer('/api/map/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap',
      }).addTo(map);

      const circle = L.circle([start.lat, start.lng], {
        radius: radiusMeters,
        color: '#c026d3',
        fillOpacity: 0.18,
        weight: 2,
      }).addTo(map);

      map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
        const snapped = snapLocation(event.latlng.lat, event.latlng.lng);
        if (!snapped) return;
        circle.setLatLng([snapped.lat, snapped.lng]);
        onChangeRef.current(snapped);
      });

      mapRef.current = map;
      circleRef.current = {
        setLatLng: (v) => circle.setLatLng([v.lat, v.lng]),
      };
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Карта создаётся один раз: перезапуск эффекта пересоздал бы её и сбросил
    // текущий вид, стоило бы владелице поменять район.
  }, [fallback, radiusMeters, value]);

  // Внешняя смена значения (сброс кнопкой) двигает круг без пересоздания карты.
  useEffect(() => {
    if (value) circleRef.current?.setLatLng(value);
  }, [value]);

  return (
    <div className={styles.wrap}>
      <span className={styles.value}>{t('locationHint')}</span>
      <div className={styles.map} ref={containerRef} />
      <div className={styles.row}>
        <span className={styles.value}>
          {value
            ? t('locationManual', { lat: value.lat.toFixed(2), lng: value.lng.toFixed(2) })
            : t('locationFromDistrict')}
        </span>
        {value ? (
          <button type="button" className={styles.reset} onClick={() => onChange(null)}>
            {t('locationReset')}
          </button>
        ) : null}
      </div>
      <span className={styles.value}>
        {t('locationPrecision', { km: (LOCATION_GRID_DEGREES * 111).toFixed(1) })}
      </span>
    </div>
  );
}
