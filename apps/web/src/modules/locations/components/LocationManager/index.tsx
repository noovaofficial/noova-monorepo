'use client';

import {
  type CityAdmin,
  type Country,
  DEFAULT_LOCALE,
  LOCALES,
  type Translated,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  addDistrict,
  createCity,
  createCountry,
  fetchCities,
  fetchCountries,
  LocationsError,
  updateCity,
  updateCountry,
  updateDistrict,
} from '@/modules/locations/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Locations.module.css';

const emptyNames = (): Translated =>
  Object.fromEntries(LOCALES.map((locale) => [locale, ''])) as Translated;

/** Поля названия на все языки: неполный набор API не примет (N-35). */
function NameFields({
  value,
  onChange,
  idPrefix,
}: {
  value: Translated;
  onChange: (next: Translated) => void;
  idPrefix: string;
}) {
  return (
    <div className={styles.formRow}>
      {LOCALES.map((locale) => (
        <div className={styles.field} key={locale}>
          <label className={styles.label} htmlFor={`${idPrefix}-${locale}`}>
            {locale.toUpperCase()}
          </label>
          <input
            className={styles.input}
            id={`${idPrefix}-${locale}`}
            value={value[locale]}
            onChange={(event) => onChange({ ...value, [locale]: event.target.value })}
            required
          />
        </div>
      ))}
    </div>
  );
}

export function LocationManager() {
  const t = useTranslations('locations');
  const { user, status } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const countries = useQuery({
    queryKey: queryKeys.adminCountries(),
    queryFn: fetchCountries,
    enabled: isAdmin,
  });
  const cities = useQuery({
    queryKey: queryKeys.adminCities(),
    queryFn: fetchCities,
    enabled: isAdmin,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminCountries() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminCities() });
  };

  // Сообщение сервера показываем как есть: там объяснено, что именно не так —
  // занятый слуг, недостающий язык, дубль кода страны.
  const run = <T,>(action: () => Promise<T>, after?: () => void) => {
    setError(null);
    return action()
      .then((result) => {
        refresh();
        after?.();
        return result;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof LocationsError && cause.message ? cause.message : t('failed'));
        return undefined;
      });
  };

  const countryForm = useCountryForm(run, t);
  const cityForm = useCityForm(run, countries.data ?? [], t);

  if (status === 'loading') return <p className={styles.empty}>…</p>;
  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
        <span className={styles.hint}>{t('subtitle')}</span>
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('countries')}</h2>
        <p className={`${styles.notice} ${styles.noticeWarn}`}>{t('legalWarning')}</p>

        <div className={styles.list}>
          {(countries.data ?? []).map((country) => (
            <CountryRow key={country.id} country={country} run={run} t={t} />
          ))}
          {countries.data?.length === 0 ? <p className={styles.empty}>{t('noCountries')}</p> : null}
        </div>

        {countryForm}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('cities')}</h2>

        <div className={styles.list}>
          {(cities.data ?? []).map((city) => (
            <CityRow key={city.id} city={city} run={run} t={t} />
          ))}
          {cities.data?.length === 0 ? <p className={styles.empty}>{t('noCities')}</p> : null}
        </div>

        {cityForm}
      </section>
    </div>
  );
}

/** undefined вместо void: при ошибке результата нет, но промис разрешается. */
type Runner = <T>(action: () => Promise<T>, after?: () => void) => Promise<T | undefined>;
type Translate = ReturnType<typeof useTranslations<'locations'>>;

function CountryRow({ country, run, t }: { country: Country; run: Runner; t: Translate }) {
  const toggle = useMutation({
    mutationFn: () =>
      run(() => updateCountry(country.id, { name: country.name, isActive: !country.isActive })),
  });

  return (
    <div className={`${styles.row} ${country.isActive ? '' : styles.rowOff}`}>
      <div className={styles.rowMain}>
        <span className={styles.rowName}>
          {country.code} · {country.name[DEFAULT_LOCALE]}
        </span>
        <span className={styles.rowMeta}>{t('cityCount', { count: country.cityCount })}</span>
      </div>
      <Button variant="secondary" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
        {country.isActive ? t('disable') : t('enable')}
      </Button>
    </div>
  );
}

function CityRow({ city, run, t }: { city: CityAdmin; run: Runner; t: Translate }) {
  const [adding, setAdding] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState<Translated>(emptyNames);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const toggle = useMutation({
    mutationFn: () =>
      run(() =>
        updateCity(city.id, {
          name: city.name,
          countryId: city.countryId,
          lat: city.lat ?? 0,
          lng: city.lng ?? 0,
          isActive: !city.isActive,
        }),
      ),
  });

  const add = useMutation({
    mutationFn: () =>
      run(
        () =>
          addDistrict(city.id, {
            slug,
            name,
            lat: Number(lat),
            lng: Number(lng),
            isActive: true,
          }),
        () => {
          setAdding(false);
          setSlug('');
          setName(emptyNames());
          setLat('');
          setLng('');
        },
      ),
  });

  return (
    <div className={`${styles.row} ${city.isActive ? '' : styles.rowOff}`}>
      <div className={styles.rowMain}>
        <span className={styles.rowName}>
          {city.name[DEFAULT_LOCALE]} · /{city.slug}
        </span>
        <span className={styles.rowMeta}>
          {city.countryCode} · {t('profileCount', { count: city.profileCount })}
        </span>

        {city.districts.length > 0 ? (
          <div className={styles.districts}>
            {city.districts.map((district) => (
              <DistrictChip key={district.id} district={district} run={run} t={t} />
            ))}
          </div>
        ) : (
          <span className={styles.rowMeta}>{t('noDistricts')}</span>
        )}

        {adding ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`d-slug-${city.id}`}>
                  {t('slug')}
                </label>
                <input
                  className={styles.input}
                  id={`d-slug-${city.id}`}
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`d-lat-${city.id}`}>
                  {t('lat')}
                </label>
                <input
                  className={styles.input}
                  id={`d-lat-${city.id}`}
                  value={lat}
                  onChange={(event) => setLat(event.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`d-lng-${city.id}`}>
                  {t('lng')}
                </label>
                <input
                  className={styles.input}
                  id={`d-lng-${city.id}`}
                  value={lng}
                  onChange={(event) => setLng(event.target.value)}
                  required
                />
              </div>
            </div>
            <NameFields value={name} onChange={setName} idPrefix={`d-name-${city.id}`} />
            <div className={styles.actions}>
              <Button type="submit" disabled={add.isPending}>
                {t('save')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      <div className={styles.actions}>
        {adding ? null : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('addDistrict')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
          {city.isActive ? t('disable') : t('enable')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Район: чип с названием, по нажатию — форма правки.
 *
 * Отключение вынесено в форму, а не на сам чип: нажатие, молча меняющее
 * состояние без подтверждения, слишком легко сделать промахом мимо соседнего.
 */
function DistrictChip({
  district,
  run,
  t,
}: {
  district: CityAdmin['districts'][number];
  run: Runner;
  t: Translate;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState<Translated>(district.name);
  const [lat, setLat] = useState(String(district.lat));
  const [lng, setLng] = useState(String(district.lng));
  const [isActive, setIsActive] = useState(district.isActive);

  const save = useMutation({
    mutationFn: () =>
      run(
        () => updateDistrict(district.id, { name, lat: Number(lat), lng: Number(lng), isActive }),
        () => setEditing(false),
      ),
  });

  if (!editing) {
    return (
      <button
        type="button"
        className={`${styles.district} ${district.isActive ? '' : styles.districtOff}`}
        onClick={() => setEditing(true)}
        title={t('editDistrict')}
      >
        {district.name[DEFAULT_LOCALE]}
      </button>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className={styles.formRow}>
        <div className={styles.field}>
          <span className={styles.label}>{t('slug')}</span>
          <input className={styles.input} value={district.slug} readOnly />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`de-lat-${district.id}`}>
            {t('lat')}
          </label>
          <input
            className={styles.input}
            id={`de-lat-${district.id}`}
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`de-lng-${district.id}`}>
            {t('lng')}
          </label>
          <input
            className={styles.input}
            id={`de-lng-${district.id}`}
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            required
          />
        </div>
      </div>

      <NameFields value={name} onChange={setName} idPrefix={`de-name-${district.id}`} />

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        {t('active')}
      </label>

      <div className={styles.actions}>
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function useCountryForm(run: Runner, t: Translate) {
  const [code, setCode] = useState('');
  const [name, setName] = useState<Translated>(emptyNames);

  const create = useMutation({
    mutationFn: () =>
      run(
        () => createCountry({ code, name, isActive: true }),
        () => {
          setCode('');
          setName(emptyNames());
        },
      ),
  });

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="country-code">
            {t('code')}
          </label>
          <input
            className={styles.input}
            id="country-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={2}
            required
          />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix="country-name" />
      <div className={styles.actions}>
        <Button type="submit" disabled={create.isPending}>
          {t('addCountry')}
        </Button>
      </div>
    </form>
  );
}

function useCityForm(run: Runner, countries: Country[], t: Translate) {
  const [slug, setSlug] = useState('');
  const [countryId, setCountryId] = useState('');
  const [name, setName] = useState<Translated>(emptyNames);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const create = useMutation({
    mutationFn: () =>
      run(
        () =>
          createCity({
            slug,
            name,
            countryId: countryId || (countries[0]?.id ?? ''),
            lat: Number(lat),
            lng: Number(lng),
            isActive: true,
            districts: [],
          }),
        () => {
          setSlug('');
          setName(emptyNames());
          setLat('');
          setLng('');
        },
      ),
  });

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="city-slug">
            {t('slug')}
          </label>
          <input
            className={styles.input}
            id="city-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="city-country">
            {t('country')}
          </label>
          <select
            className={styles.select}
            id="city-country"
            value={countryId}
            onChange={(event) => setCountryId(event.target.value)}
          >
            {countries.map((country) => (
              <option key={country.id} value={country.id}>
                {country.code} · {country.name[DEFAULT_LOCALE]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="city-lat">
            {t('lat')}
          </label>
          <input
            className={styles.input}
            id="city-lat"
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="city-lng">
            {t('lng')}
          </label>
          <input
            className={styles.input}
            id="city-lng"
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            required
          />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix="city-name" />
      <p className={styles.hint}>{t('districtsLater')}</p>
      <div className={styles.actions}>
        <Button type="submit" disabled={create.isPending}>
          {t('addCity')}
        </Button>
      </div>
    </form>
  );
}
