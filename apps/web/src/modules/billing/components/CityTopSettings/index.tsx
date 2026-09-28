'use client';

import type { CityTopList, CityTopRow } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchCityTop, saveCityTop } from '@/modules/billing/api';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './CityTopSettings.module.css';

/**
 * ТОП по городам (только админ): у каждого города свои цена недели и число
 * мест; пустое поле — значение по умолчанию из «Монетизации». Занятые места
 * не снимаются, если лимит опустили ниже занятого: новые покупки просто
 * закрыты, пока места не освободятся.
 */
export function CityTopSettings() {
  const t = useTranslations('billing');
  const { user, status } = useSession();
  const router = useRouter();
  const isAdmin = user?.role === 'admin';

  const query = useQuery({
    queryKey: queryKeys.cityTop(),
    queryFn: fetchCityTop,
    enabled: status === 'authenticated' && isAdmin,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;
  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }
  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;
  if (query.isError) return <p className={styles.empty}>{t('loadFailed')}</p>;
  if (!query.data) return <p className={styles.empty}>{t('loading')}</p>;

  return <Table data={query.data} />;
}

function Table({ data }: { data: CityTopList }) {
  const t = useTranslations('billing');
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('cityTopTitle')}</h1>
      <p className={styles.lead}>{t('cityTopLead')}</p>
      <p className={styles.defaults}>
        {t('cityTopDefaults', { price: data.defaults.weekGc, slots: data.defaults.slots })}
      </p>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('cityTopColCity')}</th>
              <th scope="col" className={styles.num}>
                {t('cityTopColTaken')}
              </th>
              <th scope="col">{t('cityTopColPrice')}</th>
              <th scope="col">{t('cityTopColSlots')}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {data.cities.map((city) => (
              <CityRow key={city.cityId} city={city} defaults={data.defaults} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const toInput = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
};

function CityRow({ city, defaults }: { city: CityTopRow; defaults: CityTopList['defaults'] }) {
  const t = useTranslations('billing');
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(city.weekGcOverride?.toString() ?? '');
  const [slots, setSlots] = useState(city.slotsOverride?.toString() ?? '');

  const weekGc = toInput(price);
  const slotsValue = toInput(slots);
  const invalid =
    (weekGc !== null && (!Number.isInteger(weekGc) || weekGc < 1)) ||
    (slotsValue !== null && (!Number.isInteger(slotsValue) || slotsValue < 1 || slotsValue > 200));
  const dirty = weekGc !== city.weekGcOverride || slotsValue !== city.slotsOverride;

  const save = useMutation({
    mutationFn: (input: { weekGc: number | null; slots: number | null }) =>
      saveCityTop(city.cityId, input),
    onSuccess: (list) => queryClient.setQueryData(queryKeys.cityTop(), list),
  });

  const overCapacity = city.taken > city.slots;

  return (
    <tr>
      <th scope="row" className={styles.city}>
        {city.name}
        <span className={styles.sub}>{city.countryCode}</span>
      </th>
      <td className={`${styles.num} ${overCapacity ? styles.over : ''}`}>
        {city.taken} / {city.slots}
      </td>
      <td>
        <input
          className={styles.input}
          inputMode="numeric"
          value={price}
          placeholder={String(defaults.weekGc)}
          aria-label={`${city.name}: ${t('cityTopColPrice')}`}
          onChange={(event) => setPrice(event.target.value)}
        />
      </td>
      <td>
        <input
          className={styles.input}
          inputMode="numeric"
          value={slots}
          placeholder={String(defaults.slots)}
          aria-label={`${city.name}: ${t('cityTopColSlots')}`}
          onChange={(event) => setSlots(event.target.value)}
        />
      </td>
      <td className={styles.actions}>
        <Button
          variant="secondary"
          disabled={!dirty || invalid || save.isPending}
          onClick={() => save.mutate({ weekGc, slots: slotsValue })}
        >
          {t('cityTopSave')}
        </Button>
        {city.weekGcOverride !== null || city.slotsOverride !== null ? (
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={() => {
              setPrice('');
              setSlots('');
              save.mutate({ weekGc: null, slots: null });
            }}
          >
            {t('cityTopReset')}
          </Button>
        ) : null}
        {save.isError ? <span className={styles.err}>{t('cityTopFailed')}</span> : null}
      </td>
    </tr>
  );
}
