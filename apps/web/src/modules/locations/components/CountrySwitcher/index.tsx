'use client';

import type { CityOption, CountryOption } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import styles from './CountrySwitcher.module.css';

/**
 * Переключатель страны в шапке, слева от `CitySwitcher` (N-42).
 *
 * Показывается только когда активных стран больше одной — и только на
 * витринных страницах, как и `CitySwitcher`: на анкете, в кабинете и в
 * админке смена страны бессмысленна.
 *
 * В отличие от города, страна не сохраняет страницу при переключении:
 * каталог и карта остаются городскими (N-42), общего среза «каталог всей
 * страны» для двух разных стран не существует, поэтому переключение всегда
 * ведёт на главную новой страны — так же, как переход по логотипу.
 */
export function CountrySwitcher({
  cities,
  countries,
}: {
  cities: CityOption[];
  countries: CountryOption[];
}) {
  const t = useTranslations('cityPicker');
  const pathname = usePathname();
  const router = useRouter();

  const [, first = ''] = pathname.split('/');
  const currentCountryCode =
    cities.find((city) => city.slug === first)?.country.code ??
    countries.find((country) => country.code.toLowerCase() === first.toLowerCase())?.code;

  if (!currentCountryCode || countries.length < 2) return null;

  return (
    <label className={styles.wrap}>
      <span className="visually-hidden">{t('countrySwitchLabel')}</span>

      {/* Значок виден только на телефоне; на широком экране его прячет CSS. */}
      <span className={styles.pin}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
        </svg>
      </span>

      <select
        className={styles.select}
        value={currentCountryCode}
        onChange={(event) => router.push(`/${event.target.value.toLowerCase()}`)}
      >
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </select>
    </label>
  );
}
