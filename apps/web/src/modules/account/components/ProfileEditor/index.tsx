'use client';

import type {
  CityOption,
  ContactInput,
  OwnPhoto,
  OwnProfile,
  PriceSlotInput,
  ProfileServiceInput,
  ServiceGroup,
  UpdateProfileInput,
} from '@noova/shared';
import {
  AMENITIES,
  type Amenity,
  AROUND_THE_CLOCK,
  appearanceTypeSchema,
  bodyTypeSchema,
  bookingPolicySchema,
  breastSizeSchema,
  breastTypeSchema,
  eyeColorSchema,
  hairColorSchema,
  type Locale,
  type PaymentMethod,
  pubicHairSchema,
  SPOKEN_LANGUAGES,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import {
  AccountError,
  deleteProfile,
  fetchCities,
  fetchOwnProfile,
  fetchServiceCatalog,
  pauseProfile,
  publishProfile,
  submitProfile,
  updateProfile,
} from '@/modules/account/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';
import { ContactPicker } from '../ContactPicker';
import { LocationPicker } from '../LocationPicker';
import { PhotoManager } from '../PhotoManager';
import { ProfileStatusBadge } from '../ProfileStatusBadge';
import { ServicePicker } from '../ServicePicker';

type Notice = { kind: 'ok' | 'error' | 'warn'; key: string } | null;

/** Цены в форме — в евро, в контракте — в центах. Конвертируем на границе. */
const toEuro = (cents: number | null) => (cents === null ? '' : String(cents / 100));
const toCents = (euro: string) => {
  const value = Number(euro.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
};

/**
 * Выпадающий список по перечислению. Значения приходят из контракта,
 * подписи — из словаря по ключу: в БД лежит ключ, и иначе его не перевести.
 */
function EnumSelect({
  name,
  label,
  options,
  namespace,
  defaultValue,
}: {
  name: string;
  label: string;
  options: readonly string[];
  namespace: string;
  defaultValue: string | null;
}) {
  const t = useTranslations(namespace);
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={name}>
        {label}
      </label>
      <select className={styles.select} id={name} name={name} defaultValue={defaultValue ?? ''}>
        <option value="">—</option>
        {options.map((value) => (
          <option key={value} value={value}>
            {t(value)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Кнопка «Сохранить» живёт в боковой панели, вне <form> — их связывает id. */
const FORM_ID = 'profile-editor-form';

type HoursRow = { weekday: number; opensAt: string; closesAt: string };

const emptyWeek = (): HoursRow[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt: '', closesAt: '' }));

/** «10:30» → 630. Формат даёт <input type="time">, разбирать вручную нечего. */
const toMinutes = (value: string): number => {
  const [h = '0', m = '0'] = value.split(':');
  return Number(h) * 60 + Number(m);
};

const toHhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Какое сообщение показать по ответу сервера.
 *
 * Раньше любой 400 объявлялся ошибкой в контактах — предположение верное до
 * появления салонных полей: ошибку в часах работы форма тоже называла
 * контактами, и владелец правил не то. Теперь причина берётся из разбора по
 * полям, который сервер и так присылает.
 */
function saveErrorKey(error: unknown): 'hoursInvalid' | 'contactInvalid' | 'saveFailed' {
  if (!(error instanceof AccountError) || error.status !== 400) return 'saveFailed';

  const fields = error.issues.map((issue) => issue.field);
  if (fields.some((field) => field.startsWith('hours'))) return 'hoursInvalid';
  if (fields.some((field) => field.startsWith('contacts'))) return 'contactInvalid';
  // Разбора нет — остаётся прежнее предположение: остальные поля формы
  // ограничены самим вводом, и до сервера некорректными почти не доходят.
  return fields.length === 0 ? 'contactInvalid' : 'saveFailed';
}

export function ProfileEditor({ profileId }: { profileId: string }) {
  const t = useTranslations('account');
  // Язык для справочников: города и услуги переведены на стороне API.
  const locale = useLocale() as Locale;
  const tLang = useTranslations('languageNames');
  const { user, status: sessionStatus } = useSession();
  // Салон — это анкета: его поля показываем в этой же форме (N-34).
  const isSalon = user?.advertiserKind === 'salon';
  const tc = useTranslations('company');
  const router = useRouter();

  const queryClient = useQueryClient();

  /**
   * Серверные данные живут в Query, редактируемые — в локальном состоянии.
   * Это не дублирование: пока владелица правит форму, черновик не должен
   * перезаписываться фоновым обновлением кэша. Ровно тот случай, когда
   * локальное состояние оправдано (см. N-19).
   */
  const [prices, setPrices] = useState<PriceSlotInput[]>([]);
  const [services, setServices] = useState<ProfileServiceInput[]>([]);
  const [contacts, setContacts] = useState<ContactInput[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [photos, setPhotos] = useState<OwnPhoto[]>([]);
  const [citySlug, setCitySlug] = useState('');
  // --- Салон: адрес, часы и удобства заведения (N-34). Салон — это анкета,
  // поэтому поля живут здесь, а не в отдельной форме компании.
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [hours, setHours] = useState<HoursRow[]>(() => emptyWeek());
  // Что стояло в дне до того, как его отметили круглосуточным. Снятие галочки
  // возвращает прежнее время, а не оставляет сутки, которых владелица не
  // вводила. Ключ — день недели.
  const [hoursBefore, setHoursBefore] = useState<Record<number, HoursRow>>({});
  const [notice, setNotice] = useState<Notice>(null);

  // Сутки в том же виде, в каком их держат поля времени.
  const DAY_OPENS = toHhmm(AROUND_THE_CLOCK.opensAt);
  const DAY_CLOSES = toHhmm(AROUND_THE_CLOCK.closesAt);
  const isDayAllDay = (row: HoursRow) => row.opensAt === DAY_OPENS && row.closesAt === DAY_CLOSES;
  // Общая галочка не хранится отдельно, а выводится из дней: два источника
  // правды здесь означали бы расписание, расходящееся с флагом над ним.
  const allDay = hours.length === 7 && hours.every(isDayAllDay);

  /** Отметить или снять сутки у одного дня, запомнив прежнее время. */
  function setDayAllDay(weekday: number, on: boolean) {
    const current = hours.find((h) => h.weekday === weekday);
    if (on && current) setHoursBefore({ ...hoursBefore, [weekday]: current });
    setHours(
      hours.map((h) => {
        if (h.weekday !== weekday) return h;
        if (on) return { weekday, opensAt: DAY_OPENS, closesAt: DAY_CLOSES };
        const back = hoursBefore[weekday];
        return back && !isDayAllDay(back) ? back : { weekday, opensAt: '', closesAt: '' };
      }),
    );
  }

  const enabled = sessionStatus === 'authenticated';

  /** Кэш анкеты обновляем ответом сервера, список в кабинете — инвалидацией. */
  const applyUpdated = (updated: OwnProfile) => {
    // Сервер вернул уже нормализованные значения — перезапрашивать их лишний
    // круг. Засев черновика подхватит их эффектом, и владелица увидит, во что
    // превратилось её «0170…», а не решит, что сохранилось как набрано.
    queryClient.setQueryData(queryKeys.ownProfile(profileId), updated);
    // Список анкет показывает статус: после публикации или снятия он устарел.
    void queryClient.invalidateQueries({ queryKey: queryKeys.ownProfiles() });
  };

  const save = useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(profileId, input),
    onSuccess: (updated) => {
      applyUpdated(updated);
      setNotice({ kind: 'ok', key: 'saved' });
    },
    onError: (error) => {
      setNotice({ kind: 'error', key: saveErrorKey(error) });
    },
  });

  const act = useMutation({
    mutationFn: (action: (id: string) => Promise<OwnProfile>) => action(profileId),
    onSuccess: applyUpdated,
    onError: (error) => {
      setNotice({
        kind: 'error',
        key:
          error instanceof AccountError && error.status === 403
            ? 'verificationRequired'
            : 'saveFailed',
      });
    },
  });

  /**
   * Удаление анкеты — отдельно от удаления учётной записи: у салона анкет
   * несколько, и убрать одну, не потеряв аккаунт, обычное дело.
   */
  const remove = useMutation({
    mutationFn: () => deleteProfile(profileId, deletePassword),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownProfiles() });
      router.push('/account/profiles');
    },
    onError: (error) => {
      setNotice({
        kind: 'error',
        key:
          error instanceof AccountError && error.status === 401
            ? 'deleteWrongPassword'
            : 'deleteFailed',
      });
    },
  });

  const pending = save.isPending || act.isPending || remove.isPending;

  const profileQuery = useQuery({
    queryKey: queryKeys.ownProfile(profileId),
    queryFn: () => fetchOwnProfile(profileId),
    enabled,
    // Пока форма открыта, фоновое обновление только мешает: оно затрёт
    // несохранённые правки при следующем засеве.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const profile = profileQuery.data ?? null;

  const citiesQuery = useQuery({
    queryKey: queryKeys.cities(locale),
    queryFn: () => fetchCities(locale),
    enabled,
    staleTime: 60 * 60 * 1000,
  });
  const cities: CityOption[] = citiesQuery.data ?? [];

  // Каталог зависит от вида анкеты — значит ждёт её загрузки.
  const catalogQuery = useQuery({
    queryKey: queryKeys.serviceCatalog(profile?.kind ?? '', locale),
    queryFn: () => fetchServiceCatalog(profile?.kind ?? 'escort', locale),
    enabled: enabled && profile !== null,
    staleTime: 60 * 60 * 1000,
  });
  const catalog: ServiceGroup[] = catalogQuery.data ?? [];

  // Засев черновика из ответа сервера. Это не загрузка в эффекте, а
  // синхронизация локальной формы с пришедшими данными — иначе правки
  // владелицы негде было бы держать.
  useEffect(() => {
    if (!profile) return;
    setPrices(profile.prices);
    setContacts(profile.contacts);
    setLanguages(profile.languages);
    setPayments(profile.payments);
    setAmenities(profile.amenities);
    setHours(
      emptyWeek().map((row) => {
        const saved = profile.hours.find((h) => h.weekday === row.weekday);
        return saved?.opensAt != null && saved.closesAt != null
          ? {
              weekday: row.weekday,
              opensAt: toHhmm(saved.opensAt),
              closesAt: toHhmm(saved.closesAt),
            }
          : row;
      }),
    );
    // Точку показываем только если её поставила владелица: выведенная из
    // района не «её выбор», и предлагать её сбросить нечего.
    setLocation(profile.hasManualLocation ? profile.location : null);
    setPhotos(profile.photos);
    setCitySlug(profile.city.slug);
  }, [profile]);

  useEffect(() => {
    if (!profile || catalog.length === 0) return;
    // Услуга, снятая с каталога, в форме не показывается — значит владелец
    // не может её убрать. Оставлять её в состоянии нечестно: он бы сохранял
    // то, чего не видит. Отбрасываем, при следующем сохранении она уйдёт.
    const available = new Set(
      catalog.flatMap((group) => group.services.map((service) => service.key)),
    );
    setServices(profile.services.filter((service) => available.has(service.key)));
  }, [profile, catalog]);

  if (sessionStatus === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!profile) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>{notice ? t(notice.key) : t('loading')}</p>
      </div>
    );
  }

  const districts = cities.find((c) => c.slug === citySlug)?.districts ?? [];

  function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const data = new FormData(event.currentTarget);
    const num = (key: string) => {
      const raw = String(data.get(key) ?? '').trim();
      if (raw === '') return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const districtSlug = String(data.get('districtSlug') ?? '');

    /** Пустая строка в селекте означает «не указано», а не пустое значение enum. */
    const enumValue = <T extends string>(key: string, allowed: readonly T[]): T | null => {
      const raw = String(data.get(key) ?? '');
      return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
    };

    save.mutate({
      displayName: String(data.get('displayName')).trim(),
      description: String(data.get('description') ?? ''),
      citySlug: String(data.get('citySlug')),
      districtSlug: districtSlug === '' ? null : districtSlug,
      age: num('age'),
      heightCm: num('heightCm'),
      weightKg: num('weightKg'),
      languages,
      // У салона секции внешности нет, и слать эти поля незачем.
      ...(profile?.kind === 'escort'
        ? {
            hairColor: enumValue('hairColor', hairColorSchema.options),
            eyeColor: enumValue('eyeColor', eyeColorSchema.options),
            breastSize: enumValue('breastSize', breastSizeSchema.options),
            breastType: enumValue('breastType', breastTypeSchema.options),
            bodyType: enumValue('bodyType', bodyTypeSchema.options),
            pubicHair: enumValue('pubicHair', pubicHairSchema.options),
            hasPiercing: data.get('hasPiercing') === 'on',
            hasTattoos: data.get('hasTattoos') === 'on',
            appearanceType: enumValue('appearanceType', appearanceTypeSchema.options),
          }
        : {}),
      // Салонные поля шлём только салону: у анкеты человека адреса и часов
      // работы быть не должно, и сервер их всё равно отбросит.
      ...(isSalon
        ? {
            address: String(data.get('address') ?? '').trim() || null,
            directions: String(data.get('directions') ?? '').trim() || null,
            minSessionMinutes: num('minSessionMinutes'),
            bookingPolicy: enumValue('bookingPolicy', bookingPolicySchema.options),
            payments,
            amenities: amenities as Amenity[],
            hours: hours
              .filter((h) => h.opensAt !== '' && h.closesAt !== '')
              .map((h) => ({
                weekday: h.weekday,
                opensAt: toMinutes(h.opensAt),
                closesAt: toMinutes(h.closesAt),
              })),
          }
        : {}),
      services,
      // Незаполненную строку не шлём: владелица добавила её и передумала,
      // и отказ сохранения из-за пустого поля был бы наказанием за это.
      // Один «+», оставшийся от маски, — тоже пустая строка.
      contacts: contacts.filter((c) => /[\d@a-z]/i.test(c.value)),
      // Пустые строки в тарифах означают «нет такой цены», а не ноль.
      prices: prices.filter((p) => p.incallCents !== null || p.outcallCents !== null),
    });
  }

  const runAction = (action: (id: string) => Promise<OwnProfile>) => act.mutate(action);

  const canPublish = profile.verificationStatus === 'verified';

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{profile.displayName}</h1>
        <div className={styles.cardActions}>
          <ProfileStatusBadge status={profile.status} />
          <Link href="/account/profiles">
            <Button variant="secondary">{t('title')}</Button>
          </Link>
        </div>
      </div>

      <div className={styles.layout}>
        <form className={styles.form} id={FORM_ID} onSubmit={onSave}>
          <div className={styles.section}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="displayName">
                {t('displayName')}
              </label>
              <input
                className={styles.input}
                id="displayName"
                name="displayName"
                defaultValue={profile.displayName}
                minLength={2}
                maxLength={60}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="description">
                {t('description')}
              </label>
              <textarea
                className={styles.textarea}
                id="description"
                name="description"
                defaultValue={profile.description}
                maxLength={4000}
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
                  value={citySlug}
                  onChange={(e) => setCitySlug(e.target.value)}
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
                <select
                  className={styles.select}
                  id="districtSlug"
                  name="districtSlug"
                  defaultValue={profile.district?.slug ?? ''}
                  key={citySlug}
                >
                  <option value="">—</option>
                  {districts.map((district) => (
                    <option key={district.slug} value={district.slug}>
                      {district.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {profile.kind === 'escort' ? (
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="age">
                    {t('age')}
                  </label>
                  <input
                    className={styles.input}
                    id="age"
                    name="age"
                    type="number"
                    min={18}
                    max={99}
                    defaultValue={profile.age ?? ''}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="heightCm">
                    {t('height')}
                  </label>
                  <input
                    className={styles.input}
                    id="heightCm"
                    name="heightCm"
                    type="number"
                    min={120}
                    max={230}
                    defaultValue={profile.heightCm ?? ''}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="weightKg">
                    {t('weight')}
                  </label>
                  <input
                    className={styles.input}
                    id="weightKg"
                    name="weightKg"
                    type="number"
                    min={35}
                    max={200}
                    defaultValue={profile.weightKg ?? ''}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* У салона внешности нет — секция не показывается вовсе. */}
          {profile.kind === 'escort' ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('appearanceSection')}</h2>
              <div className={styles.row}>
                <EnumSelect
                  name="hairColor"
                  label={t('hairColor')}
                  options={hairColorSchema.options}
                  namespace="hairColor"
                  defaultValue={profile.hairColor}
                />
                <EnumSelect
                  name="eyeColor"
                  label={t('eyeColor')}
                  options={eyeColorSchema.options}
                  namespace="eyeColor"
                  defaultValue={profile.eyeColor}
                />
                <EnumSelect
                  name="breastSize"
                  label={t('breastSize')}
                  options={breastSizeSchema.options}
                  namespace="breastSize"
                  defaultValue={profile.breastSize}
                />
                <EnumSelect
                  name="appearanceType"
                  label={t('appearanceType')}
                  options={appearanceTypeSchema.options}
                  namespace="appearanceType"
                  defaultValue={profile.appearanceType}
                />
                <EnumSelect
                  name="bodyType"
                  label={t('bodyTypeLabel')}
                  options={bodyTypeSchema.options}
                  namespace="bodyType"
                  defaultValue={profile.bodyType}
                />
                <EnumSelect
                  name="breastType"
                  label={t('breastTypeLabel')}
                  options={breastTypeSchema.options}
                  namespace="breastType"
                  defaultValue={profile.breastType}
                />
                <EnumSelect
                  name="pubicHair"
                  label={t('pubicHairLabel')}
                  options={pubicHairSchema.options}
                  namespace="pubicHair"
                  defaultValue={profile.pubicHair}
                />
              </div>

              <div className={styles.field}>
                <span className={styles.label}>{t('bodyArtLabel')}</span>
                <div className={styles.row}>
                  <label className={styles.serviceLabel} htmlFor="hasPiercing">
                    <input
                      id="hasPiercing"
                      name="hasPiercing"
                      type="checkbox"
                      defaultChecked={profile.hasPiercing ?? false}
                    />
                    <span>{t('piercingLabel')}</span>
                  </label>
                  <label className={styles.serviceLabel} htmlFor="hasTattoos">
                    <input
                      id="hasTattoos"
                      name="hasTattoos"
                      type="checkbox"
                      defaultChecked={profile.hasTattoos ?? false}
                    />
                    <span>{t('tattoosLabel')}</span>
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          {/* Салон: адрес, часы и удобства заведения. Показываем только ему —
              у анкеты человека адреса нет и быть не должно (N-34). */}
          {isSalon ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>{tc('cabinetSalon')}</h2>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="address">
                  {tc('address')}
                </label>
                <input
                  className={styles.input}
                  id="address"
                  name="address"
                  defaultValue={profile?.address ?? ''}
                  maxLength={300}
                />
                <span className={styles.hint}>{tc('addressHint')}</span>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="directions">
                  {tc('directions')}
                </label>
                <input
                  className={styles.input}
                  id="directions"
                  name="directions"
                  defaultValue={profile?.directions ?? ''}
                  maxLength={500}
                />
                <span className={styles.hint}>{tc('directionsHint')}</span>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="bookingPolicy">
                  {tc('booking')}
                </label>
                <select
                  className={styles.input}
                  id="bookingPolicy"
                  name="bookingPolicy"
                  defaultValue={profile?.bookingPolicy ?? ''}
                >
                  <option value="">—</option>
                  <option value="appointment">{tc('booking_appointment')}</option>
                  <option value="walk_in">{tc('booking_walk_in')}</option>
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="minSessionMinutes">
                  {tc('minSession')}
                </label>
                <input
                  className={styles.input}
                  id="minSessionMinutes"
                  name="minSessionMinutes"
                  type="number"
                  min={15}
                  max={1440}
                  step={15}
                  defaultValue={profile?.minSessionMinutes ?? ''}
                />
                <span className={styles.hint}>{tc('minSessionHint')}</span>
              </div>

              <fieldset className={styles.field}>
                <legend className={styles.label}>{tc('payments')}</legend>
                <div className={styles.checkRow}>
                  {(['cash', 'card', 'transfer'] as const).map((method) => (
                    <label className={styles.check} key={method}>
                      <input
                        type="checkbox"
                        checked={payments.includes(method)}
                        onChange={(event) =>
                          setPayments(
                            event.target.checked
                              ? [...payments, method]
                              : payments.filter((p) => p !== method),
                          )
                        }
                      />
                      {tc(`payment_${method}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.field}>
                <legend className={styles.label}>{tc('amenities')}</legend>
                <div className={styles.checkRow}>
                  {AMENITIES.map((amenity) => (
                    <label className={styles.check} key={amenity}>
                      <input
                        type="checkbox"
                        checked={amenities.includes(amenity)}
                        onChange={(event) =>
                          setAmenities(
                            event.target.checked
                              ? [...amenities, amenity]
                              : amenities.filter((a) => a !== amenity),
                          )
                        }
                      />
                      {tc(`amenity_${amenity}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.field}>
                <legend className={styles.label}>{tc('hours')}</legend>

                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={allDay}
                    onChange={(event) => {
                      const on = event.target.checked;
                      if (on) {
                        setHoursBefore(Object.fromEntries(hours.map((h) => [h.weekday, h])));
                        setHours(
                          hours.map((h) => ({
                            weekday: h.weekday,
                            opensAt: DAY_OPENS,
                            closesAt: DAY_CLOSES,
                          })),
                        );
                      } else {
                        setHours(
                          hours.map((h) => {
                            const back = hoursBefore[h.weekday];
                            return back && !isDayAllDay(back)
                              ? back
                              : { weekday: h.weekday, opensAt: '', closesAt: '' };
                          }),
                        );
                      }
                    }}
                  />
                  {tc('allDay')}
                </label>

                <span className={styles.hint}>{allDay ? tc('allDayHint') : tc('hoursHint')}</span>
                {hours.map((row) => (
                  <div className={styles.hoursRow} key={row.weekday}>
                    <span className={styles.day}>{tc(`weekday_${row.weekday}`)}</span>
                    <input
                      className={styles.timeInput}
                      type="time"
                      aria-label={`${tc(`weekday_${row.weekday}`)} — ${tc('opensAt')}`}
                      disabled={isDayAllDay(row)}
                      value={row.opensAt}
                      onChange={(event) =>
                        setHours(
                          hours.map((h) =>
                            h.weekday === row.weekday ? { ...h, opensAt: event.target.value } : h,
                          ),
                        )
                      }
                    />
                    <span>—</span>
                    <input
                      className={styles.timeInput}
                      type="time"
                      aria-label={`${tc(`weekday_${row.weekday}`)} — ${tc('closesAt')}`}
                      disabled={isDayAllDay(row)}
                      value={row.closesAt}
                      onChange={(event) =>
                        setHours(
                          hours.map((h) =>
                            h.weekday === row.weekday ? { ...h, closesAt: event.target.value } : h,
                          ),
                        )
                      }
                    />
                    <label className={styles.dayAllDay}>
                      <input
                        type="checkbox"
                        checked={isDayAllDay(row)}
                        aria-label={`${tc(`weekday_${row.weekday}`)} — ${tc('allDay')}`}
                        onChange={(event) => setDayAllDay(row.weekday, event.target.checked)}
                      />
                      {tc('allDayShort')}
                    </label>
                  </div>
                ))}
              </fieldset>
            </div>
          ) : null}

          {/* Языки — не часть внешности: они есть и у салона, и по ним идёт
              фильтр каталога. Раньше поля не было вовсе, и указать язык
              владелица не могла, хотя посетитель мог по нему искать. */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('languagesTitle')}</h2>
            <span className={styles.hint}>{t('languagesHint')}</span>

            <div className={styles.serviceGrid}>
              {SPOKEN_LANGUAGES.map((code) => {
                const checked = languages.includes(code);
                return (
                  <label
                    className={`${styles.serviceRow} ${checked ? styles.serviceRowChecked : ''}`}
                    key={code}
                    htmlFor={`lang-${code}`}
                  >
                    <span className={styles.serviceLabel}>
                      <input
                        id={`lang-${code}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setLanguages((current) =>
                            current.includes(code)
                              ? current.filter((value) => value !== code)
                              : // Порядок из справочника, а не из порядка нажатий:
                                // иначе один и тот же набор выглядит по-разному.
                                SPOKEN_LANGUAGES.filter(
                                  (value) => value === code || current.includes(value),
                                ),
                          )
                        }
                      />
                      <span className={styles.serviceName}>{tLang(code)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('prices')}</h2>

            {prices.map((price, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: строки тарифов не переупорядочиваются
              <div className={styles.priceRow} key={index}>
                <div className={styles.field}>
                  <span className={styles.label}>{t('duration')}</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={15}
                    max={1440}
                    value={price.durationMinutes}
                    onChange={(e) =>
                      setPrices((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, durationMinutes: Number(e.target.value) } : row,
                        ),
                      )
                    }
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>{t('incall')}</span>
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    value={toEuro(price.incallCents)}
                    onChange={(e) =>
                      setPrices((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, incallCents: toCents(e.target.value) } : row,
                        ),
                      )
                    }
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>{t('outcall')}</span>
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    value={toEuro(price.outcallCents)}
                    onChange={(e) =>
                      setPrices((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, outcallCents: toCents(e.target.value) } : row,
                        ),
                      )
                    }
                  />
                </div>
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => setPrices((rows) => rows.filter((_, i) => i !== index))}
                >
                  {t('removePrice')}
                </button>
              </div>
            ))}

            {prices.length < 8 ? (
              <Button
                variant="secondary"
                onClick={() =>
                  setPrices((rows) => [
                    ...rows,
                    { durationMinutes: 60, incallCents: null, outcallCents: null },
                  ])
                }
              >
                {t('addPrice')}
              </Button>
            ) : null}
          </div>

          {/* Карта после адреса: сначала город и район, потом уточнение
              точкой — иначе непонятно, что уточняется. */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('locationTitle')}</h2>
            <LocationPicker
              value={location}
              onChange={setLocation}
              // Куда смотреть, если точка ещё не поставлена: туда, где анкета
              // и так показывается.
              fallback={profile.location ?? { lat: 52.52, lng: 13.405 }}
            />
          </div>

          <ContactPicker contacts={contacts} onChange={setContacts} />

          <ServicePicker catalog={catalog} selected={services} onChange={setServices} />

          <PhotoManager profileId={profileId} photos={photos} onChange={setPhotos} />
        </form>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarCard}>
            <span className={styles.sidebarTitle}>{t('title')}</span>

            {notice ? (
              <p
                className={`${styles.notice} ${
                  notice.kind === 'ok'
                    ? styles.noticeOk
                    : notice.kind === 'warn'
                      ? styles.noticeWarn
                      : styles.noticeError
                }`}
                style={{ margin: 0 }}
              >
                {t(notice.key)}
              </p>
            ) : null}

            {/* Блокировка — не то же, что замечание при проверке: показываем
                её отдельно и первой, иначе причина теряется среди подсказок. */}
            {profile.status === 'banned' ? (
              <p className={`${styles.notice} ${styles.noticeError}`} style={{ margin: 0 }}>
                <strong>{t('profileBlocked')}</strong>
                {profile.moderationNote ? ` ${profile.moderationNote}` : ''}
              </p>
            ) : profile.moderationNote ? (
              <p className={`${styles.notice} ${styles.noticeWarn}`} style={{ margin: 0 }}>
                {t('moderationNote')}: {profile.moderationNote}
              </p>
            ) : null}

            {profile.status === 'banned' ? (
              <p className={`${styles.notice} ${styles.noticeInfo}`} style={{ margin: 0 }}>
                {t('blockedHowToFix')}
              </p>
            ) : null}

            {/* Текст зависит от статуса: «станет доступна после верификации»
                само по себе не подсказывает, что делать дальше. */}
            {/* Проверка пройдена, но анкета ещё не опубликована — статус
                «черновик» сам по себе об этом не говорит. */}
            {canPublish && profile.status !== 'published' ? (
              <p className={`${styles.notice} ${styles.noticeOk}`} style={{ margin: 0 }}>
                {t('verificationPassed')}
              </p>
            ) : null}

            {!canPublish && profile.status !== 'banned' ? (
              <p className={`${styles.notice} ${styles.noticeInfo}`} style={{ margin: 0 }}>
                {t(
                  profile.status === 'pending_verification'
                    ? 'verificationPending'
                    : profile.status === 'rejected'
                      ? 'verificationRejected'
                      : 'verificationNotSubmitted',
                )}
              </p>
            ) : null}

            <div className={styles.sidebarActions}>
              <Button type="submit" form={FORM_ID} disabled={pending}>
                {t('save')}
              </Button>

              {/* Отправка на проверку переводит заявку обратно в «ожидает»,
                  то есть уже проверенная владелица потеряла бы статус. После
                  пройденной верификации кнопки здесь быть не должно: анкету
                  остаётся только опубликовать.

                  Заблокированная анкета — исключение: там повторная проверка
                  и есть смысл действия. */}
              {profile.status === 'banned' ||
              (!canPublish && (profile.status === 'draft' || profile.status === 'rejected')) ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => runAction(submitProfile)}
                >
                  {t('submit')}
                </Button>
              ) : null}

              {canPublish && profile.status !== 'published' && profile.status !== 'banned' ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => runAction(publishProfile)}
                >
                  {t('publish')}
                </Button>
              ) : null}

              {profile.status === 'published' ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => runAction(pauseProfile)}
                >
                  {t('pause')}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Удаление отделено от остальных действий: это единственное
              необратимое из них, и оно не должно стоять в одном ряду
              с «Сохранить». */}
          <div className={`${styles.sidebarCard} ${styles.dangerCard}`}>
            <span className={styles.sidebarTitle}>{t('deleteProfileTitle')}</span>

            {deleting ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  remove.mutate();
                }}
              >
                <p className={styles.hint}>{t('deleteProfileWhat')}</p>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="delete-profile-password">
                    {t('deleteProfilePassword')}
                  </label>
                  <input
                    className={styles.input}
                    id="delete-profile-password"
                    type="password"
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                    required
                  />
                </div>
                <div className={styles.sidebarActions}>
                  <Button type="submit" disabled={pending || deletePassword.length === 0}>
                    {t('deleteProfileConfirm')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setDeleting(false);
                      setDeletePassword('');
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <p className={styles.hint}>{t('deleteProfileHint')}</p>
                <div className={styles.sidebarActions}>
                  <Button variant="secondary" disabled={pending} onClick={() => setDeleting(true)}>
                    {t('deleteProfile')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
