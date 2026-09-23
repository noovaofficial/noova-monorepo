'use client';

import {
  type AgencyPaywallInfo,
  isReadyToSubmit,
  type Locale,
  missingForReview,
  type OwnProfile,
  PROFILE_LIMIT_BY_ADVERTISER,
  profileStage,
} from '@noova/shared';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import {
  AccountError,
  createProfile,
  fetchCities,
  fetchOwnProfiles,
  ProfilePaywall,
  pauseAllProfiles,
  publishAllProfiles,
  publishProfile,
  submitAllProfiles,
} from '@/modules/account/api';
import { fetchOwnCompanyTariff } from '@/modules/agencies/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';
import { AgencyPaywallNotice } from '../AgencyPaywallNotice';
import { ProfileStageBadge } from '../ProfileStatusBadge';

export function ProfileList() {
  const locale = useLocale() as Locale;
  const t = useTranslations('account');
  const { user, status: sessionStatus } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Пустая строка — «город ещё не выбран»: до загрузки справочника берём первый.
  const [citySlug, setCitySlug] = useState('');

  const enabled = sessionStatus === 'authenticated';
  const isAgency = user?.advertiserKind === 'agency';
  const list = useQuery({ queryKey: queryKeys.ownProfiles(), queryFn: fetchOwnProfiles, enabled });
  // Тариф агентства (payments.md §3.3, D-13): лимит и предложения на
  // повышение приходят отсюда, а не из общего прайса — у агентства он свой.
  const tariff = useQuery({
    queryKey: queryKeys.ownCompanyTariff(),
    queryFn: fetchOwnCompanyTariff,
    enabled: enabled && isAgency,
    staleTime: 60 * 1000,
  });
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

  // Публикация прямо из списка — без захода в редактор, если анкета уже
  // прошла проверку и её нужно лишь включить.
  const publish = useMutation({
    mutationFn: publishProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ownProfiles() }),
  });

  const refreshProfiles = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.ownProfiles() });

  // Массовые действия агентства — на сервере одним запросом: по одной анкете
  // с клиента у сотни анкет упёрлось бы в лимиты запросов.
  const publishAll = useMutation({
    mutationFn: publishAllProfiles,
    onSuccess: ({ changed, skipped }) => {
      setBulkNotice({ kind: 'ok', text: t('bulkPublished', { changed, skipped }) });
      void refreshProfiles();
    },
    onError: (cause: unknown) =>
      setBulkNotice({
        kind: 'error',
        text:
          cause instanceof AccountError && cause.status === 402
            ? t('bulkNeedsPayment')
            : t('bulkFailed'),
      }),
  });
  const submitAll = useMutation({
    mutationFn: submitAllProfiles,
    onSuccess: ({ changed, skipped }) => {
      setBulkNotice({ kind: 'ok', text: t('bulkSubmitted', { changed, skipped }) });
      void refreshProfiles();
    },
    onError: (cause: unknown) =>
      setBulkNotice({
        kind: 'error',
        text:
          cause instanceof AccountError && cause.status === 403
            ? t('verifyEmailFirst')
            : t('bulkFailed'),
      }),
  });
  const pauseAll = useMutation({
    mutationFn: pauseAllProfiles,
    onSuccess: ({ changed }) => {
      setConfirmPause(false);
      setBulkNotice({ kind: 'ok', text: t('bulkPaused', { count: changed }) });
      void refreshProfiles();
    },
    onError: () => {
      setConfirmPause(false);
      setBulkNotice({ kind: 'error', text: t('bulkFailed') });
    },
  });

  const profiles = list.data ?? null;
  const cities = cityList.data ?? [];
  const creating = create.isPending;

  // Лимит агентства достигнут — пейвол показываем сразу из уже загруженного
  // тарифа, не дожидаясь отказа сервера: кнопка «Создать» при достигнутом
  // пределе скрыта (см. ниже), и без этого агентство никак не добралось бы
  // до предложения повысить тариф. Отказ сервера (`ProfilePaywall`, на
  // случай, если данные успели устареть) остаётся приоритетным источником.
  const reactivePaywall = create.error instanceof ProfilePaywall ? create.error.info : null;
  const proactivePaywall: AgencyPaywallInfo | null =
    isAgency && tariff.data && tariff.data.profileCount >= tariff.data.effectiveLimit
      ? {
          currentProfileCount: tariff.data.profileCount,
          effectiveLimit: tariff.data.effectiveLimit,
          currentTier: tariff.data.tariffTier,
          candidateTiers: tariff.data.candidateTiers,
        }
      : null;
  const paywall = reactivePaywall ?? proactivePaywall;

  const error = paywall
    ? null
    : create.error instanceof AccountError && create.error.status === 409
      ? 'limitReached'
      : create.isError
        ? 'saveFailed'
        : list.isError || cityList.isError || (isAgency && tariff.isError)
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
  // Предел агентства — из его тарифа (payments.md §3.3, D-13): тариф
  // назначает админ или само агентство через пейвол, и число не общее для
  // всех, как раньше (D-07), а своё у каждой компании.
  const limit =
    user.advertiserKind === null
      ? null
      : user.advertiserKind === 'agency'
        ? (tariff.data?.effectiveLimit ?? PROFILE_LIMIT_BY_ADVERTISER.agency)
        : PROFILE_LIMIT_BY_ADVERTISER[user.advertiserKind];
  const limitReached = profiles !== null && limit !== null && profiles.length >= limit;

  const completeness = (p: OwnProfile) => ({
    kind: p.kind,
    age: p.age,
    photosCount: p.photos.length,
    pricesCount: p.prices.length,
    contactsCount: p.contacts.length,
  });
  const stageOf = (p: OwnProfile) =>
    profileStage({
      ...completeness(p),
      status: p.status,
      verificationStatus: p.verificationStatus,
    });
  // Подсказка для черновиков и отклонённых: чего не хватает, чтобы анкету
  // можно было отправить на проверку.
  const missingHint = (p: OwnProfile): string | null => {
    if (p.status !== 'draft' && p.status !== 'rejected') return null;
    if (p.verificationStatus === 'verified') return null;
    const missing = missingForReview(completeness(p));
    return missing.length === 0
      ? null
      : t('missingLabel', { fields: missing.map((m) => t(`missing_${m}`)).join(', ') });
  };
  const incompleteDraftCount = profiles?.filter((p) => missingHint(p) !== null).length ?? 0;
  const submittableCount =
    profiles?.filter((p) =>
      isReadyToSubmit({
        ...completeness(p),
        status: p.status,
        verificationStatus: p.verificationStatus,
      }),
    ).length ?? 0;
  const canPublish = (p: OwnProfile) =>
    p.verificationStatus === 'verified' &&
    p.status !== 'published' &&
    p.status !== 'banned' &&
    missingForReview(completeness(p)).length === 0;
  const publishedCount = profiles?.filter((p) => p.status === 'published').length ?? 0;
  const blockedCount = profiles?.filter((p) => p.status === 'banned').length ?? 0;
  const publishableCount = profiles?.filter(canPublish).length ?? 0;
  const bulkPending = publishAll.isPending || pauseAll.isPending || submitAll.isPending;

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

  // Районы зависят от выбранного города, а не от первого в списке: иначе при
  // смене города в селекте оставались районы другого города.
  const selectedCitySlug = citySlug || cities[0]?.slug || '';
  const selectedCity = cities.find((city) => city.slug === selectedCitySlug);

  const profileCards = profiles?.map((profile) => {
    const cover = profile.photos[0];
    return (
      <div key={profile.id} className={styles.profileCard}>
        <div className={styles.profileThumb}>
          {cover ? (
            // Ссылка на неодобренное фото подписанная и живёт минуты,
            // поэтому next/image с его оптимизацией здесь не подходит.
            // biome-ignore lint/performance/noImgElement: подписанная ссылка живёт минуты, оптимизатор Next закэшировал бы её и отдавал битую
            <img src={cover.url} alt="" loading="lazy" />
          ) : (
            <span className={styles.profileThumbEmpty}>{t('noPhoto')}</span>
          )}
          <span className={styles.profileThumbStatus}>
            <ProfileStageBadge stage={stageOf(profile)} />
          </span>
        </div>
        <div className={styles.profileBody}>
          <span className={styles.cardName}>{profile.displayName}</span>
          <span className={styles.cardMeta}>
            {profile.city.name}
            {profile.district ? ` · ${profile.district.name}` : ''}
          </span>
          {missingHint(profile) ? (
            <span className={styles.missing}>{missingHint(profile)}</span>
          ) : null}
        </div>
        <div className={styles.profileActions}>
          <Link href={`/account/profiles/${profile.id}`}>
            <Button variant="secondary">{t('edit')}</Button>
          </Link>
          {canPublish(profile) ? (
            <Button
              variant="secondary"
              disabled={publish.isPending && publish.variables === profile.id}
              onClick={() => publish.mutate(profile.id)}
            >
              {t('publish')}
            </Button>
          ) : null}
          {profile.status === 'published' ? (
            <Link href={`/profile/${profile.slug}`}>
              <Button variant="secondary">{t('view')}</Button>
            </Link>
          ) : null}
        </div>
        {publish.isError && publish.variables === profile.id ? (
          <p className={`${styles.notice} ${styles.noticeError}`}>{t('publishFailed')}</p>
        ) : null}
      </div>
    );
  });

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
      {isAgency && tariff.data && !tariff.data.hasCompany ? (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>
          {t('fillCompanyFirst')} <Link href="/account/company">{t('fillCompanyLink')}</Link>
        </p>
      ) : null}
      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{t(error)}</p> : null}
      {paywall ? <AgencyPaywallNotice info={paywall} onUpgraded={() => create.reset()} /> : null}

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
              <select
                className={styles.select}
                id="citySlug"
                name="citySlug"
                value={selectedCitySlug}
                onChange={(e) => setCitySlug(e.target.value)}
                required
              >
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
              {/* key сбрасывает выбранный район при смене города: район
                  одного города к другому не относится. */}
              <select
                className={styles.select}
                id="districtSlug"
                name="districtSlug"
                key={selectedCitySlug}
              >
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
      ) : isAgency ? (
        <div className={styles.layout}>
          <div className={styles.profileGrid}>{profileCards}</div>

          <aside className={styles.sidebar}>
            <div className={styles.sidebarCard}>
              <span className={styles.sidebarTitle}>{t('statsTitle')}</span>
              <div className={styles.statRow}>
                <span>{t('statsProfiles')}</span>
                <span className={styles.statValue}>
                  {limit === null
                    ? profiles.length
                    : t('statsOf', { count: profiles.length, limit })}
                </span>
              </div>
              {limit !== null && limit > 0 ? (
                <div className={styles.progress} aria-hidden="true">
                  <div
                    className={styles.progressBar}
                    style={{ width: `${Math.min(100, (profiles.length / limit) * 100)}%` }}
                  />
                </div>
              ) : null}
              <div className={styles.statRow}>
                <span>{t('statsPublished')}</span>
                <span className={styles.statValue}>{publishedCount}</span>
              </div>
              <div className={styles.statRow}>
                <span>{t('statsBlocked')}</span>
                <span className={styles.statValue}>{blockedCount}</span>
              </div>
            </div>

            <div className={styles.sidebarCard}>
              <span className={styles.sidebarTitle}>{t('bulkTitle')}</span>
              {bulkNotice ? (
                <p
                  className={`${styles.notice} ${bulkNotice.kind === 'ok' ? styles.noticeOk : styles.noticeError}`}
                  style={{ margin: 0 }}
                >
                  {bulkNotice.text}
                </p>
              ) : null}
              <div className={styles.sidebarActions}>
                {submittableCount === 0 && incompleteDraftCount > 0 ? (
                  <span className={styles.missing}>
                    {t('submitAllIncomplete', { count: incompleteDraftCount })}
                  </span>
                ) : null}
                {submittableCount > 0 ? (
                  <Button
                    disabled={bulkPending}
                    onClick={() => {
                      setBulkNotice(null);
                      submitAll.mutate();
                    }}
                  >
                    {t('submitAll', { count: submittableCount })}
                  </Button>
                ) : null}
                <Button
                  disabled={publishableCount === 0 || bulkPending}
                  onClick={() => {
                    setBulkNotice(null);
                    publishAll.mutate();
                  }}
                >
                  {t('publishAll', { count: publishableCount })}
                </Button>
                {confirmPause ? (
                  <>
                    <span className={styles.hint}>
                      {t('pauseAllConfirm', { count: publishedCount })}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={bulkPending}
                      onClick={() => {
                        setBulkNotice(null);
                        pauseAll.mutate();
                      }}
                    >
                      {t('pauseAllYes')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={bulkPending}
                      onClick={() => setConfirmPause(false)}
                    >
                      {t('pauseAllNo')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={publishedCount === 0 || bulkPending}
                    onClick={() => setConfirmPause(true)}
                  >
                    {t('pauseAll', { count: publishedCount })}
                  </Button>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className={styles.profileGrid}>{profileCards}</div>
      )}
    </div>
  );
}
