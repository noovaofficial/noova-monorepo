'use client';

import type { CityOption, CountryOption, Locale } from '@noova/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { fetchCities, fetchCountries } from '@/modules/account/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../AuthForm.module.css';

/** Справочники страны и города для форм регистрации и настроек. */
export function useLocationOptions(): { countries: CountryOption[]; cities: CityOption[] } {
  const locale = useLocale() as Locale;
  const countries = useQuery({
    queryKey: queryKeys.countries(locale),
    queryFn: () => fetchCountries(locale),
    staleTime: 5 * 60 * 1000,
  });
  const cities = useQuery({
    queryKey: queryKeys.cities(locale),
    queryFn: () => fetchCities(locale),
    staleTime: 5 * 60 * 1000,
  });
  return { countries: countries.data ?? [], cities: cities.data ?? [] };
}

/**
 * Страна и основной город. Список городов — только выбранной страны; при смене
 * страны город сбрасывается, чтобы не остался город чужой страны.
 */
export function LocationFields({
  countryCode,
  citySlug,
  onChange,
  cityRequired,
  disabled,
  countryDisabled,
  idPrefix,
  errorKey,
}: {
  countryCode: string;
  citySlug: string;
  onChange: (next: { countryCode: string; citySlug: string }) => void;
  cityRequired: boolean;
  disabled?: boolean;
  /** Только страна: город при этом можно менять. */
  countryDisabled?: boolean;
  idPrefix: string;
  errorKey?: string | null;
}) {
  const t = useTranslations('auth');
  const { countries, cities } = useLocationOptions();
  const countryCities = cities.filter((city) => city.country.code === countryCode);

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-country`}>
          {t('country')}
        </label>
        <select
          className={styles.select}
          id={`${idPrefix}-country`}
          value={countryCode}
          disabled={disabled || countryDisabled}
          onChange={(event) => onChange({ countryCode: event.target.value, citySlug: '' })}
          required
        >
          <option value="" disabled>
            {t('chooseCountry')}
          </option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-city`}>
          {t('city')}
          {cityRequired ? '' : ` (${t('optional')})`}
        </label>
        <select
          className={styles.select}
          id={`${idPrefix}-city`}
          value={citySlug}
          disabled={disabled || countryCode === ''}
          onChange={(event) => onChange({ countryCode, citySlug: event.target.value })}
          required={cityRequired}
        >
          <option value="" disabled={cityRequired}>
            {t('chooseCity')}
          </option>
          {countryCities.map((city) => (
            <option key={city.slug} value={city.slug}>
              {city.name}
            </option>
          ))}
        </select>
        {errorKey ? <span className={styles.fieldError}>{t(errorKey)}</span> : null}
      </div>
    </>
  );
}
