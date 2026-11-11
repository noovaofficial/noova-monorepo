'use client';

import type { CityOption, CountryOption } from '@noova/shared';
import { cityFromPath, type ServiceGroup } from '@noova/shared';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FilterIcon, MapIcon } from '@/layout/Header/icons';
import { FilterPanel } from '@/modules/filters/components/FilterPanel';
import { countActiveFilters } from '@/modules/filters/params';
import { Link, usePathname } from '@/shared/i18n/navigation';
import { LOCATION_COOKIE } from '@/shared/location-cookie';
import styles from '../Header.module.css';

/**
 * Кнопка «Фильтры» в шапке — единственная точка входа в панель.
 *
 * Куда ведёт кнопка «Показать» внутри панели, зависит от страницы: на
 * каталоге и карте правки применяются к текущей выдаче (остаёмся на месте,
 * меняется только query), на остальных страницах — переходом в каталог.
 * Сама панель везде работает одинаково: копит правки локально и отправляет
 * их разом по кнопке, а не по каждому клику.
 */
export function HeaderFilters({
  catalog,
  cities,
  countries,
}: {
  catalog: ServiceGroup[];
  cities: CityOption[];
  countries: CountryOption[];
}) {
  const t = useTranslations('nav');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Второй сегмент пути — город, код страны (главная/каталог «всей страны»,
  // N-43) или ничего из этого (анкета, кабинет и т.п.). `cityFromPath` сам
  // не отличает их друг от друга — сверяем со справочниками.
  const rawFirst = cityFromPath(pathname);
  const pathCity = rawFirst ? cities.find((item) => item.slug === rawFirst) : undefined;
  const pathCountry = pathCity
    ? undefined
    : rawFirst
      ? countries.find((item) => item.code.toLowerCase() === rawFirst.toLowerCase())
      : undefined;
  const pathLocation = pathCity?.slug ?? (pathCountry ? rawFirst : null);

  // На странице анкеты, в кабинете и т.п. локации в адресе нет. Тогда берём
  // последнюю посещённую (cookie пишет прокси) — иначе панель показала бы
  // страну по умолчанию, хотя человек выбирал другую.
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    if (pathLocation) return;
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${LOCATION_COOKIE}=`))
      ?.slice(LOCATION_COOKIE.length + 1);
    setRemembered(match ? decodeURIComponent(match) : null);
  }, [pathLocation]);

  const lastCity = pathLocation ? undefined : cities.find((item) => item.slug === remembered);
  const lastCountry =
    pathLocation || lastCity
      ? undefined
      : countries.find((item) => item.code.toLowerCase() === remembered?.toLowerCase());

  const matchedCity = pathCity ?? lastCity;
  const matchedCountry = pathCountry ?? lastCountry;

  // Куда ведут «Карта» и «Показать» без конкретного города — на каталог/карту
  // той же страны, если она известна из адреса или из последнего визита,
  // иначе на страну по умолчанию.
  const defaultCountry = countries.find((item) => item.isDefault) ?? countries[0];
  const targetLocation =
    pathLocation ??
    lastCity?.slug ??
    (lastCountry ? lastCountry.code.toLowerCase() : null) ??
    defaultCountry?.code.toLowerCase() ??
    null;

  const inLocation = pathLocation ? pathname.slice(pathLocation.length + 1) : pathname;
  const onCatalog = inLocation.startsWith('/catalog');
  const kind = inLocation.startsWith('/catalog/massage') ? 'massage' : 'escort';
  const active = onCatalog ? countActiveFilters(new URLSearchParams(searchParams.toString())) : 0;
  const onMap = inLocation.endsWith('/map');

  // Список городов для сужения «всей страны» до нескольких (N-43) — только
  // когда конкретный город ещё не выбран: внутри одного города выбирать
  // город незачем.
  const countryCode = matchedCity?.country.code ?? matchedCountry?.code ?? defaultCountry?.code;
  const currency = countries.find((item) => item.code === countryCode)?.currency ?? 'EUR';
  const countryCities = matchedCity
    ? []
    : cities.filter((item) => item.country.code === countryCode);

  // Карта наследует текущие фильтры: переход «список ↔ карта» ничего
  // не сбрасывает, иначе выбранное приходится набирать заново.
  const mapQuery = onCatalog ? searchParams.toString() : '';
  const mapHref = `${targetLocation ? `/${targetLocation}` : ''}/catalog/${kind}/map${mapQuery ? `?${mapQuery}` : ''}`;

  // Куда ведёт кнопка «Показать»: на каталоге и карте — текущая страница
  // (правки лишь дописывают её query), иначе — переход в каталог этого
  // города/страны с чистого листа.
  const targetPath = onCatalog
    ? pathname
    : `${targetLocation ? `/${targetLocation}` : ''}/catalog/${kind}`;

  return (
    <>
      <button type="button" className={styles.filterBtn} onClick={() => setOpen(true)}>
        <FilterIcon />
        {/* На телефоне от кнопки остаётся значок: подпись занимала место,
            которого во второй строке нет, а значок фильтра узнаётся сам.
            Название остаётся доступным экранному диктору. */}
        <span className={styles.btnLabel}>{t('filters')}</span>
        <span className="visually-hidden">{t('filters')}</span>
        {active > 0 ? <span className={styles.filterCount}>{active}</span> : null}
      </button>

      {/* Карта — рядом с фильтрами и после них: это другой способ смотреть
          ту же выдачу, а не ещё один фильтр. На самой карте кнопку не
          показываем — возврат в список есть в её заголовке. */}
      {onMap ? null : (
        <Link className={styles.filterBtn} href={mapHref}>
          <MapIcon />
          {/* Подпись короче на телефоне: «Анкеты на карте» переносилось
              в две строки и ломало высоту ряда. */}
          <span className={styles.btnLabel}>{t('mapView')}</span>
          <span className={styles.btnLabelSm}>{t('mapViewShort')}</span>
        </Link>
      )}

      {open ? (
        <FilterPanel
          kind={kind}
          catalog={catalog}
          countryCities={countryCities}
          currency={currency}
          initial={onCatalog ? searchParams.toString() : ''}
          onClose={() => setOpen(false)}
          targetPath={targetPath}
        />
      ) : null}
    </>
  );
}
