'use client';

import type { ListingKind, Locale, MapCluster } from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { fetchMapClusters } from '@/modules/catalog/api';
import { formatMoney } from '@/shared/format';
import { Link } from '@/shared/i18n/navigation';
import styles from './CatalogMap.module.css';

type Props = { kind: ListingKind; locale: Locale };

/** Куда смотреть, пока точек нет: центр Берлина — единственный город каталога. */
const FALLBACK = { lat: 52.52, lng: 13.405 };

/**
 * Каталог на карте. Точка — это всегда группа: координаты огрублены до сетки,
 * и все анкеты одной ячейки лежат на одинаковых координатах. Кружок с числом
 * честнее булавки — он показывает плотность и не обещает точности, которой
 * нет.
 *
 * Фильтры общие с каталогом: карта читает те же параметры из адреса, поэтому
 * переход «список ↔ карта» ничего не сбрасывает.
 */
export function CatalogMap({ kind, locale }: Props) {
  const t = useTranslations('map');
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);
  const layerRef = useRef<{ clearLayers: () => void } | null>(null);

  const query = new URLSearchParams(searchParams.toString());
  query.set('kind', kind);
  const queryString = query.toString();

  const {
    data: clusters,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['catalog-map', queryString],
    queryFn: () => fetchMapClusters(queryString),
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    void (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        const map = L.map(containerRef.current).setView([FALLBACK.lat, FALLBACK.lng], 11);
        // Плитки через собственный домен: прямой запрос сообщил бы
        // тайл-серверу адрес посетителя и то, что он смотрит каталог 18+.
        L.tileLayer('/tiles/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© OpenStreetMap',
        }).addTo(map);
        mapRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
      }

      const layer = layerRef.current;
      if (!layer || !clusters) return;

      // Перерисовываем слой целиком при смене фильтров: точек десятки,
      // и сравнивать их по одной дороже, чем построить заново.
      layer.clearLayers();

      const points: [number, number][] = [];
      for (const cluster of clusters) {
        points.push([cluster.lat, cluster.lng]);

        const marker = L.marker([cluster.lat, cluster.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div class="noova-cluster">${cluster.total}</div>`,
            iconSize: [42, 42],
            iconAnchor: [21, 21],
          }),
        });

        marker.bindPopup(renderPopup(cluster, locale));
        marker.addTo(layer as never);
      }

      // Подгоняем вид под найденное: иначе после фильтра карта остаётся
      // на прежнем месте, и кажется, что ничего не нашлось.
      if (points.length > 0) {
        (mapRef.current as never as { fitBounds: (b: unknown, o: unknown) => void }).fitBounds(
          L.latLngBounds(points),
          { padding: [48, 48], maxZoom: 14 },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clusters, locale]);

  // Карту убираем только при уходе со страницы, а не при смене фильтров.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    },
    [],
  );

  const total = clusters?.reduce((sum, cluster) => sum + cluster.total, 0) ?? 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
        <div className={styles.actions}>
          <span className={styles.count}>
            {isPending ? t('loading') : t('found', { count: total })}
          </span>
          <Link className={styles.link} href={`/catalog/${kind}?${searchParams.toString()}`}>
            {t('backToList')}
          </Link>
        </div>
      </div>

      {isError ? <p className={styles.empty}>{t('failed')}</p> : null}

      <div className={styles.map} ref={containerRef} />
      <p className={styles.count} style={{ marginTop: 'var(--space3)' }}>
        {t('privacyNote')}
      </p>
    </div>
  );
}

/**
 * Содержимое всплывающей карточки. Leaflet принимает строку HTML, поэтому
 * подписи экранируем вручную — React здесь не участвует.
 */
function renderPopup(cluster: MapCluster, locale: Locale): string {
  const esc = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
    );

  const items = cluster.profiles
    .map((profile) => {
      const price = formatMoney(profile.fromPrice, locale) ?? '';
      const photo = profile.photoUrl
        ? `<img class="${styles.popupPhoto}" src="${esc(profile.photoUrl)}" alt="" width="34" height="34" loading="lazy">`
        : `<span class="${styles.popupPhoto}"></span>`;
      return `<a class="${styles.popupItem}" href="/${locale}/profile/${esc(profile.slug)}">
        ${photo}
        <span>
          <span class="${styles.popupName}">${esc(profile.displayName)}${profile.age ? `, ${profile.age}` : ''}</span><br>
          <span class="${styles.popupMeta}">${esc(price)}</span>
        </span>
      </a>`;
    })
    .join('');

  const hidden = cluster.total - cluster.profiles.length;
  const more = hidden > 0 ? `<span class="${styles.popupMore}">+${hidden}</span>` : '';

  return `<div class="${styles.popup}">${items}${more}</div>`;
}
