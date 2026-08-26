'use client';

import type { CityAdmin, Translated } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  createCity,
  fetchCities,
  fetchCountries,
  updateCity,
  updateCountry,
} from '@/modules/locations/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Locations.module.css';
import { EntityRow, emptyNames, label, NameFields, useRunner } from '../shared';

/** Второй уровень: одна страна — её данные и её города (N-32). */
export function CountryDetail({ code }: { code: string }) {
  const t = useTranslations('locations');
  const { user, status } = useSession();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin';

  const countries = useQuery({
    queryKey: queryKeys.adminCountries(),
    queryFn: fetchCountries,
    enabled: isAdmin,
  });
  const country = (countries.data ?? []).find((c) => c.code.toLowerCase() === code.toLowerCase());

  const cities = useQuery({
    queryKey: queryKeys.adminCities(country?.id),
    queryFn: () => fetchCities(country?.id),
    enabled: isAdmin && country !== undefined,
  });

  const { run, error } = useRunner(t, () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminCountries() });
    void queryClient.invalidateQueries({ queryKey: ['admin-cities'], exact: false });
  });

  if (status === 'loading' || countries.isLoading) return <p className={styles.empty}>…</p>;
  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;
  if (!country) return <p className={styles.empty}>{t('countryNotFound')}</p>;

  return (
    <div className={styles.wrap}>
      <nav className={styles.crumbs}>
        <Link href="/admin/locations">{t('title')}</Link>
        <span>/</span>
        <span>{label(country.name)}</span>
      </nav>

      <div className={styles.head}>
        <h1 className={styles.title}>{label(country.name)}</h1>
        <span className={styles.hint}>{t('cityCount', { count: country.cityCount })}</span>
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('countryInfo')}</h2>
        <CountryForm country={country} run={run} t={t} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('cities')}</h2>
        <div className={styles.list}>
          {(cities.data ?? []).map((city) => (
            <CityRow key={city.id} city={city} countryCode={code} run={run} t={t} />
          ))}
          {cities.data?.length === 0 ? <p className={styles.empty}>{t('noCities')}</p> : null}
        </div>
        <CityForm countryId={country.id} run={run} t={t} />
      </section>
    </div>
  );
}

type Country = Awaited<ReturnType<typeof fetchCountries>>[number];
type Runner = ReturnType<typeof useRunner>['run'];
type Translate = ReturnType<typeof useTranslations<'locations'>>;

/** Код страны не редактируется: по нему её находят города и адрес экрана. */
function CountryForm({ country, run, t }: { country: Country; run: Runner; t: Translate }) {
  const [name, setName] = useState<Translated>(country.name);
  const [isActive, setIsActive] = useState(country.isActive);

  // Данные приходят запросом: до его завершения полей ещё нет, и без
  // синхронизации форма осталась бы с пустыми названиями.
  useEffect(() => {
    setName(country.name);
    setIsActive(country.isActive);
  }, [country]);

  const save = useMutation({
    mutationFn: () => run(() => updateCountry(country.id, { name, isActive })),
  });

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
          <span className={styles.label}>{t('code')}</span>
          <input className={styles.input} value={country.code} readOnly />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix={`c-${country.id}`} />
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
      </div>
    </form>
  );
}

function CityRow({
  city,
  countryCode,
  run,
  t,
}: {
  city: CityAdmin;
  countryCode: string;
  run: Runner;
  t: Translate;
}) {
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

  return (
    <EntityRow
      name={`${label(city.name)} · /${city.slug}`}
      meta={`${t('districtCount', { count: city.districts.length })} · ${t('profileCount', { count: city.profileCount })}`}
      isActive={city.isActive}
      href={`/admin/locations/${countryCode}/${city.slug}`}
      onToggle={() => toggle.mutate()}
      pending={toggle.isPending}
      t={t}
    />
  );
}

function CityForm({ countryId, run, t }: { countryId: string; run: Runner; t: Translate }) {
  const [slug, setSlug] = useState('');
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
            countryId,
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
