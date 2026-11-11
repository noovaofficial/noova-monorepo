'use client';

import type { CityOption, CountryOption } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { currentLocation } from '@/modules/locations/current-location';
import { Overlay } from '@/overlays/Overlay';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import { LOCATION_ACK_COOKIE, OPEN_LOCATION_EVENT } from '@/shared/location-cookie';
import styles from './LocationSwitcher.module.css';

/** Сколько городов показывать без поиска: дальше без него не найти. */
const SEARCH_FROM = 8;

/**
 * Выбор места в шапке — одна кнопка с названием текущего места вместо двух
 * выпадающих списков. Название на кнопке отвечает на вопрос «что я сейчас
 * смотрю», а панель по нажатию даёт выбор страны, города или «всей страны»
 * и поиск по городам.
 *
 * Показывается только на витрине, где локация есть в адресе (N-42); на
 * анкете, в кабинете и админке выбирать нечего.
 *
 * Выбор сохраняет страницу: из каталога массажа одного города попадаешь в
 * каталог массажа другого города или всей страны, а не на чью-то главную.
 * Сделанный вручную выбор заодно снимает вопрос «Это ваша локация?».
 */
export function LocationSwitcher({
  cities,
  countries,
}: {
  cities: CityOption[];
  countries: CountryOption[];
}) {
  const t = useTranslations('cityPicker');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const current = currentLocation(pathname, cities, countries);

  // Плашка «Это ваша локация?» открывает панель через событие: она живёт
  // отдельно, и общего родителя с кнопкой у неё нет.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_LOCATION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_LOCATION_EVENT, onOpen);
  }, []);

  if (!current) return null;

  const label = current.city
    ? current.city.name
    : t('wholeCountryShort', { country: current.country.name });

  return (
    <>
      <button
        type="button"
        className={styles.button}
        aria-haspopup="dialog"
        aria-label={`${t('buttonLabel')}: ${current.city ? `${current.city.name}, ` : ''}${current.country.name}`}
        onClick={() => setOpen(true)}
      >
        <PinIcon />
        <span className={styles.label}>{label}</span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <Panel
          cities={cities}
          countries={countries}
          currentCountry={current.country.code}
          currentCity={current.city?.slug ?? null}
          onClose={() => setOpen(false)}
          onPick={(slug) => {
            rememberChoice();
            setOpen(false);
            router.push(`/${[slug, ...current.rest].filter(Boolean).join('/')}`);
          }}
        />
      ) : null}
    </>
  );
}

function rememberChoice(): void {
  try {
    document.cookie = `${LOCATION_ACK_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Куки запрещены — плашка просто спросит ещё раз.
  }
}

function Panel({
  cities,
  countries,
  currentCountry,
  currentCity,
  onClose,
  onPick,
}: {
  cities: CityOption[];
  countries: CountryOption[];
  currentCountry: string;
  currentCity: string | null;
  onClose: () => void;
  onPick: (slug: string) => void;
}) {
  const t = useTranslations('cityPicker');
  // Страна в панели — то, что человек разглядывает, а не обязательно
  // текущая: выбор страны листает города, переход происходит по выбору места.
  const [country, setCountry] = useState(currentCountry);
  const [query, setQuery] = useState('');

  const countryName = countries.find((item) => item.code === country)?.name ?? '';
  const countryCities = useMemo(
    () => cities.filter((item) => item.country.code === country),
    [cities, country],
  );
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? countryCities.filter((item) => item.name.toLocaleLowerCase().includes(needle))
    : countryCities;

  return (
    <Overlay onClose={onClose}>
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('panelTitle')}>
        {/* Фон — настоящая кнопка, а не div с обработчиком: закрытие мышью не
            требует обходить правила доступности. Из табуляции убрана — для
            клавиатуры есть Escape и кнопка «Закрыть». */}
        <button
          type="button"
          className={styles.backdrop}
          onClick={onClose}
          aria-label={t('close')}
          tabIndex={-1}
        />
        <div className={styles.panel}>
          <div className={styles.head}>
            <span className={styles.title}>{t('panelTitle')}</span>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label={t('close')}
            >
              ×
            </button>
          </div>

          <div className={styles.body}>
            {countries.length > 1 ? (
              <div>
                <span className={styles.heading}>{t('countryHeading')}</span>
                <div className={styles.chips}>
                  {countries.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      className={`${styles.chip} ${item.code === country ? styles.chipActive : ''}`}
                      aria-pressed={item.code === country}
                      onClick={() => {
                        setCountry(item.code);
                        setQuery('');
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.cities}>
              <span className={styles.heading}>{t('cityHeading')}</span>
              {countryCities.length >= SEARCH_FROM ? (
                <input
                  className={styles.search}
                  type="search"
                  value={query}
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchPlaceholder')}
                  onChange={(event) => setQuery(event.target.value)}
                />
              ) : null}

              <ul className={styles.list}>
                {needle ? null : (
                  <li>
                    <button
                      type="button"
                      className={`${styles.item} ${
                        country === currentCountry && currentCity === null ? styles.itemActive : ''
                      }`}
                      onClick={() => onPick(country.toLowerCase())}
                    >
                      {t('wholeCountry', { country: countryName })}
                    </button>
                  </li>
                )}
                {shown.map((item) => (
                  <li key={item.slug}>
                    <button
                      type="button"
                      className={`${styles.item} ${item.slug === currentCity ? styles.itemActive : ''}`}
                      onClick={() => onPick(item.slug)}
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
              {needle && shown.length === 0 ? (
                <p className={styles.none}>{t('noMatches')}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function PinIcon() {
  return (
    <svg
      className={styles.pin}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
