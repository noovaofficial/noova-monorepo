'use client';

import type { Translated } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { createCountry, fetchCountries, updateCountry } from '@/modules/locations/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Locations.module.css';
import { EntityRow, emptyNames, label, NameFields, useRunner } from '../shared';

/**
 * Первый уровень географии: только страны (N-32).
 *
 * Раньше страны, города и районы жили на одном экране списками подряд. С
 * ростом каталога это перестаёт читаться: у страны десятки городов, у города
 * — десятки районов. Разбиение по уровням оставляет на экране один вид
 * записей и один набор действий.
 */
export function CountryList() {
  const t = useTranslations('locations');
  const { user, status } = useSession();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin';

  const countries = useQuery({
    queryKey: queryKeys.adminCountries(),
    queryFn: fetchCountries,
    enabled: isAdmin,
  });

  const { run, error } = useRunner(t, () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminCountries() });
  });

  if (status === 'loading') return <p className={styles.empty}>…</p>;
  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
        <span className={styles.hint}>{t('countriesHint')}</span>
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p> : null}
      <p className={`${styles.notice} ${styles.noticeWarn}`}>{t('legalWarning')}</p>

      <div className={styles.list}>
        {(countries.data ?? []).map((country) => (
          <CountryRow key={country.id} country={country} run={run} t={t} />
        ))}
        {countries.data?.length === 0 ? <p className={styles.empty}>{t('noCountries')}</p> : null}
      </div>

      <CountryForm run={run} t={t} />
    </div>
  );
}

type Country = Awaited<ReturnType<typeof fetchCountries>>[number];

function CountryRow({
  country,
  run,
  t,
}: {
  country: Country;
  run: ReturnType<typeof useRunner>['run'];
  t: ReturnType<typeof useTranslations<'locations'>>;
}) {
  const toggle = useMutation({
    mutationFn: () =>
      run(() => updateCountry(country.id, { name: country.name, isActive: !country.isActive })),
  });

  return (
    <EntityRow
      name={`${country.code} · ${label(country.name)}`}
      meta={t('cityCount', { count: country.cityCount })}
      isActive={country.isActive}
      href={`/admin/locations/${country.code.toLowerCase()}`}
      onToggle={() => toggle.mutate()}
      pending={toggle.isPending}
      t={t}
    />
  );
}

function CountryForm({
  run,
  t,
}: {
  run: ReturnType<typeof useRunner>['run'];
  t: ReturnType<typeof useTranslations<'locations'>>;
}) {
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
