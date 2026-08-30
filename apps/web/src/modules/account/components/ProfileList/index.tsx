'use client';

import { type Locale, PROFILE_LIMIT_BY_ADVERTISER } from '@noova/shared';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { AccountError, createProfile, fetchCities, fetchOwnProfiles } from '@/modules/account/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';
import { ProfileStatusBadge } from '../ProfileStatusBadge';

export function ProfileList() {
  const locale = useLocale() as Locale;
  const t = useTranslations('account');
  const { user, status: sessionStatus } = useSession();
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);

  const enabled = sessionStatus === 'authenticated';
  const list = useQuery({ queryKey: queryKeys.ownProfiles(), queryFn: fetchOwnProfiles, enabled });
  // Справочник городов меняется раз в год — свежесть держим долгую, иначе
  // он перезапрашивается на каждом заходе в кабинет без всякой пользы.
  const cityList = useQuery({
    queryKey: queryKeys.cities(locale),
    queryFn: () => fetchCities(locale),
    enabled,
    staleTime: 60 * 60 * 1000,
  });

  const create = useMutation({
    mutationFn: createProfile,
    // Инвалидировать список незачем: сразу уходим на страницу новой анкеты,
    // и к моменту возврата он всё равно устареет по времени.
    onSuccess: (created) => router.push(`/account/profiles/${created.id}`),
  });

  const profiles = list.data ?? null;
  const cities = cityList.data ?? [];
  const creating = create.isPending;
  const error =
    create.error instanceof AccountError && create.error.status === 409
      ? 'limitReached'
      : create.isError
        ? 'saveFailed'
        : list.isError || cityList.isError
          ? 'loadFailed'
          : null;

  if (sessionStatus === 'loading') {
    return <p className={styles.empty}>{t('loading')}</p>;
  }

  if (sessionStatus === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (user?.role !== 'advertiser') {
    return <p className={styles.empty}>{t('onlyAdvertisers')}</p>;
  }

  // Лимит берём из общей таблицы, а не пересчитываем здесь: раньше условие
  // проверяло только `individual`, и салон видел кнопку «создать» при уже
  // заведённой записи — форма открывалась, а отказ приходил только с сервера.
  // Тип не задан — не блокируем: сервер всё равно проверит, а лишний отказ
  // на пустом месте хуже лишней кнопки.
  const limitReached =
    profiles !== null &&
    user.advertiserKind !== null &&
    profiles.length >= PROFILE_LIMIT_BY_ADVERTISER[user.advertiserKind];

  // Салон — это анкета, но называть её так в его кабинете значит путать:
  // владелец салона заводит салон, а не «анкету» (N-34).
  const isSalon = user.advertiserKind === 'salon';

  function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const districtSlug = String(data.get('districtSlug') ?? '');

    create.mutate({
      displayName: String(data.get('displayName')).trim(),
      citySlug: String(data.get('citySlug')),
      ...(districtSlug ? { districtSlug } : {}),
    });
  }

  const selectedCity = cities[0];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t(isSalon ? 'salonTitle' : 'title')}</h1>
        {!limitReached && !showForm ? (
          <Button onClick={() => setShowForm(true)}>{t(isSalon ? 'salonCreate' : 'create')}</Button>
        ) : null}
      </div>

      {user.isEmailVerified ? null : (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>{t('verifyEmailFirst')}</p>
      )}
      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{t(error)}</p> : null}

      {showForm ? (
        <form className={styles.section} onSubmit={onCreate}>
          <h2 className={styles.sectionTitle}>{t(isSalon ? 'salonCreateTitle' : 'createTitle')}</h2>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="displayName">
              {t(isSalon ? 'salonDisplayName' : 'displayName')}
            </label>
            <input
              className={styles.input}
              id="displayName"
              name="displayName"
              minLength={2}
              maxLength={60}
              required
            />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="citySlug">
                {t('city')}
              </label>
              <select className={styles.select} id="citySlug" name="citySlug" required>
                {cities.map((city) => (
                  <option key={city.slug} value={city.slug}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="districtSlug">
                {t('district')}
              </label>
              <select className={styles.select} id="districtSlug" name="districtSlug">
                <option value="">—</option>
                {selectedCity?.districts.map((district) => (
                  <option key={district.slug} value={district.slug}>
                    {district.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.actions}>
            <Button type="submit" disabled={creating}>
              {t(isSalon ? 'salonCreate' : 'create')}
            </Button>
          </div>
        </form>
      ) : null}

      {profiles === null ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : profiles.length === 0 && !showForm ? (
        <div className={styles.empty}>
          <p>{t(isSalon ? 'salonEmpty' : 'empty')}</p>
          <p className={styles.hint}>{t(isSalon ? 'salonEmptyHint' : 'emptyHint')}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {profiles.map((profile) => (
            <div key={profile.id} className={styles.card}>
              <div className={styles.cardMain}>
                <span className={styles.cardName}>{profile.displayName}</span>
                <span className={styles.cardMeta}>
                  {profile.city.name}
                  {profile.district ? ` · ${profile.district.name}` : ''}
                </span>
              </div>
              <div className={styles.cardActions}>
                <ProfileStatusBadge status={profile.status} />
                <Link href={`/account/profiles/${profile.id}`}>
                  <Button variant="secondary">{t('edit')}</Button>
                </Link>
                {profile.status === 'published' ? (
                  <Link href={`/profile/${profile.slug}`}>
                    <Button variant="secondary">{t('view')}</Button>
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
