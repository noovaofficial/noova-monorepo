'use client';

import type { CityAdmin, Translated } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { addDistrict, fetchCities, updateCity, updateDistrict } from '@/modules/locations/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Locations.module.css';
import { EntityRow, emptyNames, label, NameFields, useRunner } from '../shared';

/** Третий уровень: один город — его данные и его районы (N-32). */
export function CityDetail({ countryCode, citySlug }: { countryCode: string; citySlug: string }) {
  const t = useTranslations('locations');
  const { user, status } = useSession();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin';

  const cities = useQuery({
    queryKey: queryKeys.adminCities(),
    queryFn: () => fetchCities(),
    enabled: isAdmin,
  });
  const city = (cities.data ?? []).find((c) => c.slug === citySlug);

  const { run, error } = useRunner(t, () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-cities'], exact: false });
  });

  if (status === 'loading' || cities.isLoading) return <p className={styles.empty}>…</p>;
  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;
  if (!city) return <p className={styles.empty}>{t('cityNotFound')}</p>;

  return (
    <div className={styles.wrap}>
      <nav className={styles.crumbs}>
        <Link href="/admin/locations">{t('title')}</Link>
        <span>/</span>
        <Link href={`/admin/locations/${countryCode}`}>{city.countryCode}</Link>
        <span>/</span>
        <span>{label(city.name)}</span>
      </nav>

      <div className={styles.head}>
        <h1 className={styles.title}>{label(city.name)}</h1>
        <span className={styles.hint}>{t('profileCount', { count: city.profileCount })}</span>
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('cityInfo')}</h2>
        <CityForm city={city} run={run} t={t} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('districts')}</h2>
        <p className={styles.hint}>{t('districtsOptional')}</p>

        <div className={styles.list}>
          {city.districts.map((district) => (
            <DistrictRow key={district.id} district={district} run={run} t={t} />
          ))}
          {city.districts.length === 0 ? <p className={styles.empty}>{t('noDistricts')}</p> : null}
        </div>

        <DistrictForm cityId={city.id} run={run} t={t} />
      </section>
    </div>
  );
}

type Runner = ReturnType<typeof useRunner>['run'];
type Translate = ReturnType<typeof useTranslations<'locations'>>;
type District = CityAdmin['districts'][number];

/** Слуг города не редактируется: он в адресах каталога и во внешних ссылках. */
function CityForm({ city, run, t }: { city: CityAdmin; run: Runner; t: Translate }) {
  const [name, setName] = useState<Translated>(city.name);
  const [lat, setLat] = useState(String(city.lat ?? 0));
  const [lng, setLng] = useState(String(city.lng ?? 0));
  const [isActive, setIsActive] = useState(city.isActive);

  useEffect(() => {
    setName(city.name);
    setLat(String(city.lat ?? 0));
    setLng(String(city.lng ?? 0));
    setIsActive(city.isActive);
  }, [city]);

  const save = useMutation({
    mutationFn: () =>
      run(() =>
        updateCity(city.id, {
          name,
          countryId: city.countryId,
          lat: Number(lat),
          lng: Number(lng),
          isActive,
        }),
      ),
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
          <span className={styles.label}>{t('slug')}</span>
          <input className={styles.input} value={city.slug} readOnly />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`ci-lat-${city.id}`}>
            {t('lat')}
          </label>
          <input
            className={styles.input}
            id={`ci-lat-${city.id}`}
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`ci-lng-${city.id}`}>
            {t('lng')}
          </label>
          <input
            className={styles.input}
            id={`ci-lng-${city.id}`}
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            required
          />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix={`ci-${city.id}`} />
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

function DistrictRow({ district, run, t }: { district: District; run: Runner; t: Translate }) {
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

  const toggle = useMutation({
    mutationFn: () =>
      run(() =>
        updateDistrict(district.id, {
          name: district.name,
          lat: district.lat,
          lng: district.lng,
          isActive: !district.isActive,
        }),
      ),
  });

  if (!editing) {
    return (
      <div className={`${styles.row} ${district.isActive ? '' : styles.rowOff}`}>
        <div className={styles.rowMain}>
          <span className={styles.rowName}>
            {label(district.name)} · /{district.slug}
          </span>
          <span className={styles.rowMeta}>
            {t('profileCount', { count: district.profileCount })}
          </span>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('edit')}
          </Button>
          <Button variant="secondary" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
            {district.isActive ? t('disable') : t('enable')}
          </Button>
        </div>
      </div>
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
          <label className={styles.label} htmlFor={`d-lat-${district.id}`}>
            {t('lat')}
          </label>
          <input
            className={styles.input}
            id={`d-lat-${district.id}`}
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`d-lng-${district.id}`}>
            {t('lng')}
          </label>
          <input
            className={styles.input}
            id={`d-lng-${district.id}`}
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            required
          />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix={`d-${district.id}`} />
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

function DistrictForm({ cityId, run, t }: { cityId: string; run: Runner; t: Translate }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState<Translated>(emptyNames);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const create = useMutation({
    mutationFn: () =>
      run(
        () =>
          addDistrict(cityId, {
            slug,
            name,
            lat: Number(lat),
            lng: Number(lng),
            isActive: true,
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
          <label className={styles.label} htmlFor="d-new-slug">
            {t('slug')}
          </label>
          <input
            className={styles.input}
            id="d-new-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="d-new-lat">
            {t('lat')}
          </label>
          <input
            className={styles.input}
            id="d-new-lat"
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="d-new-lng">
            {t('lng')}
          </label>
          <input
            className={styles.input}
            id="d-new-lng"
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            required
          />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix="d-new" />
      <div className={styles.actions}>
        <Button type="submit" disabled={create.isPending}>
          {t('addDistrict')}
        </Button>
      </div>
    </form>
  );
}
