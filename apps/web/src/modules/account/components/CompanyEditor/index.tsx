'use client';

import {
  AMENITIES,
  type BookingPolicy,
  CONTACT_TYPES,
  type CompanyInput,
  type ContactType,
  companyInputSchema,
  type PaymentMethod,
  SPOKEN_LANGUAGES,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { AccountError, fetchOwnCompany, saveOwnCompany } from '@/modules/account/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { queryKeys } from '@/shared/query-keys';
import styles from './CompanyEditor.module.css';

type Contact = { type: ContactType; value: string };

/** Список неизменяем и непуст, но тип этого не знает — фиксируем один раз. */
const DEFAULT_CONTACT: ContactType = CONTACT_TYPES[0] ?? 'phone';

type PriceRow = { title: string; durationMinutes: string; price: string };

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
 * Данные компании в кабинете (N-33).
 *
 * Одна компания на учётную запись, поэтому здесь нет списка и выбора: форма
 * либо заводит её, либо правит. Тип не выбирается — он взят из типа учётной
 * записи при регистрации, и сменить его значит сменить смысл размещения.
 */
export function CompanyEditor() {
  const t = useTranslations('company');
  const tLang = useTranslations('languageNames');
  const { user, status } = useSession();
  const queryClient = useQueryClient();

  const kind = user?.advertiserKind;
  const allowed = kind === 'agency' || kind === 'salon';

  const query = useQuery({
    queryKey: queryKeys.ownCompany(),
    queryFn: fetchOwnCompany,
    enabled: allowed,
  });

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  // Семь строк всегда: пустая пара означает выходной, и отдельной галочки
  // «закрыто» не нужно — незаполненный день и есть закрытый.
  const [hours, setHours] = useState<HoursRow[]>(() => emptyWeek());
  const [directions, setDirections] = useState('');
  const [minSession, setMinSession] = useState('');
  const [booking, setBooking] = useState<BookingPolicy | ''>('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Данные приходят запросом: до его завершения полей нет, и без синхронизации
  // форма осталась бы пустой поверх уже заведённой компании.
  useEffect(() => {
    const company = query.data;
    if (!company) return;
    setSlug(company.slug);
    setName(company.name);
    setDescription(company.description ?? '');
    setAddress(company.address ?? '');
    setContacts(company.contacts);
    setDirections(company.directions ?? '');
    setMinSession(company.minSessionMinutes ? String(company.minSessionMinutes) : '');
    setBooking(company.bookingPolicy ?? '');
    setLanguages(company.languages);
    setPayments(company.payments);
    setAmenities(company.amenities);
    setPrices(
      company.prices.map((p) => ({
        title: p.title,
        durationMinutes: String(p.durationMinutes),
        price: String(p.priceCents / 100),
      })),
    );
    setHours(
      emptyWeek().map((row) => {
        const saved = company.hours.find((h) => h.weekday === row.weekday);
        return saved?.opensAt != null && saved.closesAt != null
          ? {
              weekday: row.weekday,
              opensAt: toHhmm(saved.opensAt),
              closesAt: toHhmm(saved.closesAt),
            }
          : row;
      }),
    );
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      const isSalonKind = kind === 'salon';
      const input: CompanyInput = companyInputSchema.parse({
        slug,
        kind,
        name,
        description: description.trim() || undefined,
        // Адрес отправляем только у салона: у агентства его не бывает,
        // и пустая строка из формы упёрлась бы в проверку контракта.
        address: kind === 'salon' && address.trim() ? address.trim() : undefined,
        contacts: contacts.filter((c) => c.value.trim() !== ''),
        // Отправляем только заполненные дни: остальные — выходные, и слать
        // семь пустых пар значит хранить то, что и так подразумевается.
        hours:
          kind === 'salon'
            ? hours
                .filter((h) => h.opensAt !== '' && h.closesAt !== '')
                .map((h) => ({
                  weekday: h.weekday,
                  opensAt: toMinutes(h.opensAt),
                  closesAt: toMinutes(h.closesAt),
                }))
            : [],
        directions: directions.trim() || undefined,
        minSessionMinutes: isSalonKind && minSession ? Number(minSession) : undefined,
        bookingPolicy: isSalonKind && booking ? booking : undefined,
        languages,
        payments,
        amenities: isSalonKind ? amenities : [],
        prices: isSalonKind
          ? prices
              .filter((p) => p.title.trim() !== '' && p.durationMinutes !== '')
              .map((p) => ({
                title: p.title.trim(),
                durationMinutes: Number(p.durationMinutes),
                // Цена вводится в евро, хранится в центах: копейки в Float
                // однажды разойдутся, как и у анкет.
                priceCents: Math.round(Number(p.price || 0) * 100),
              }))
          : [],
        isActive: true,
      });
      return saveOwnCompany(input);
    },
    onSuccess: () => {
      setError(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ownCompany() });
    },
    onError: (cause: unknown) => {
      setSaved(false);
      // Сообщение сервера показываем как есть: в нём сказано, что именно
      // не так — занятый адрес, несовпадение типа, слишком короткое имя.
      setError(cause instanceof AccountError && cause.message ? cause.message : t('failed'));
    },
  });

  if (status === 'loading') return <p className={styles.empty}>…</p>;
  if (!allowed) return <p className={styles.empty}>{t('onlyCompanies')}</p>;

  const isSalon = kind === 'salon';

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t(isSalon ? 'cabinetSalon' : 'cabinetAgency')}</h1>
        <span className={styles.hint}>
          {query.data ? t('publicAt', { slug: query.data.slug }) : t('notCreated')}
        </span>
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p> : null}
      {saved && !error ? (
        <p className={`${styles.notice} ${styles.noticeOk}`}>{t('saved')}</p>
      ) : null}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          try {
            save.mutate();
          } catch {
            setError(t('checkFields'));
          }
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="company-name">
            {t('name')}
          </label>
          <input
            className={styles.input}
            id="company-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={120}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="company-slug">
            {t('slug')}
          </label>
          <input
            className={styles.input}
            id="company-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            pattern="[a-z0-9-]+"
          />
          <span className={styles.hint}>{t('slugHint')}</span>
        </div>

        {isSalon ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="company-address">
              {t('address')}
            </label>
            <input
              className={styles.input}
              id="company-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={300}
            />
            <span className={styles.hint}>{t('addressHint')}</span>
          </div>
        ) : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="company-description">
            {t('description')}
          </label>
          <textarea
            className={styles.textarea}
            id="company-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={4000}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="company-directions">
            {t('directions')}
          </label>
          <input
            className={styles.input}
            id="company-directions"
            value={directions}
            onChange={(event) => setDirections(event.target.value)}
            maxLength={500}
          />
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>{t('languages')}</legend>
          <div className={styles.chips}>
            {SPOKEN_LANGUAGES.map((code) => (
              <label className={styles.chipCheck} key={code}>
                <input
                  type="checkbox"
                  checked={languages.includes(code)}
                  onChange={(event) =>
                    setLanguages(
                      event.target.checked
                        ? [...languages, code]
                        : languages.filter((l) => l !== code),
                    )
                  }
                />
                {tLang.has(code) ? tLang(code) : code}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>{t('payments')}</legend>
          <div className={styles.chips}>
            {(['cash', 'card', 'transfer'] as const).map((method) => (
              <label className={styles.chipCheck} key={method}>
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
                {t(`payment_${method}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {isSalon ? (
          <>
            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>{t('amenities')}</legend>
              <div className={styles.chips}>
                {AMENITIES.map((amenity) => (
                  <label className={styles.chipCheck} key={amenity}>
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
                    {t(`amenity_${amenity}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="company-booking">
                  {t('booking')}
                </label>
                <select
                  className={styles.select}
                  id="company-booking"
                  value={booking}
                  onChange={(event) => setBooking(event.target.value as BookingPolicy | '')}
                >
                  <option value="">—</option>
                  <option value="appointment">{t('booking_appointment')}</option>
                  <option value="walk_in">{t('booking_walk_in')}</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="company-min-session">
                  {t('minSession')}
                </label>
                <input
                  className={styles.input}
                  id="company-min-session"
                  type="number"
                  min={15}
                  max={1440}
                  step={15}
                  value={minSession}
                  onChange={(event) => setMinSession(event.target.value)}
                />
              </div>
            </div>

            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>{t('prices')}</legend>
              {prices.map((row, index) => (
                // Порядок — единственный ключ: названия могут повторяться,
                // пока строку не заполнили.
                // biome-ignore lint/suspicious/noArrayIndexKey: порядок и есть идентичность
                <div className={styles.priceRow} key={index}>
                  <input
                    className={styles.input}
                    value={row.title}
                    placeholder={t('priceTitle')}
                    onChange={(event) =>
                      setPrices(
                        prices.map((p, i) =>
                          i === index ? { ...p, title: event.target.value } : p,
                        ),
                      )
                    }
                  />
                  <input
                    className={styles.time}
                    type="number"
                    min={15}
                    step={15}
                    value={row.durationMinutes}
                    placeholder={t('duration')}
                    onChange={(event) =>
                      setPrices(
                        prices.map((p, i) =>
                          i === index ? { ...p, durationMinutes: event.target.value } : p,
                        ),
                      )
                    }
                  />
                  <input
                    className={styles.time}
                    type="number"
                    min={0}
                    step={5}
                    value={row.price}
                    placeholder={t('price')}
                    onChange={(event) =>
                      setPrices(
                        prices.map((p, i) =>
                          i === index ? { ...p, price: event.target.value } : p,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPrices(prices.filter((_, i) => i !== index))}
                  >
                    {t('remove')}
                  </Button>
                </div>
              ))}
              {prices.length < 20 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setPrices([...prices, { title: '', durationMinutes: '60', price: '' }])
                  }
                >
                  {t('addPrice')}
                </Button>
              ) : null}
            </fieldset>
          </>
        ) : null}

        {isSalon ? (
          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>{t('hours')}</legend>
            <span className={styles.hint}>{t('hoursHint')}</span>
            {hours.map((row) => (
              <div className={styles.hoursRow} key={row.weekday}>
                <span className={styles.day}>{t(`weekday_${row.weekday}`)}</span>
                <input
                  className={styles.time}
                  type="time"
                  aria-label={`${t(`weekday_${row.weekday}`)} — ${t('opensAt')}`}
                  value={row.opensAt}
                  onChange={(event) =>
                    setHours(
                      hours.map((h) =>
                        h.weekday === row.weekday ? { ...h, opensAt: event.target.value } : h,
                      ),
                    )
                  }
                />
                <span className={styles.dash}>—</span>
                <input
                  className={styles.time}
                  type="time"
                  aria-label={`${t(`weekday_${row.weekday}`)} — ${t('closesAt')}`}
                  value={row.closesAt}
                  onChange={(event) =>
                    setHours(
                      hours.map((h) =>
                        h.weekday === row.weekday ? { ...h, closesAt: event.target.value } : h,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </fieldset>
        ) : null}

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>{t('contacts')}</legend>
          {contacts.map((contact, index) => (
            // Порядок задаёт отображение, и он же — единственный ключ:
            // значения могут повторяться, пока строку не заполнили.
            // biome-ignore lint/suspicious/noArrayIndexKey: порядок и есть идентичность
            <div className={styles.contactRow} key={index}>
              <select
                className={styles.select}
                value={contact.type}
                onChange={(event) =>
                  setContacts(
                    contacts.map((c, i) =>
                      i === index ? { ...c, type: event.target.value as ContactType } : c,
                    ),
                  )
                }
              >
                {CONTACT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`contact_${type}`)}
                  </option>
                ))}
              </select>
              <input
                className={styles.input}
                value={contact.value}
                onChange={(event) =>
                  setContacts(
                    contacts.map((c, i) => (i === index ? { ...c, value: event.target.value } : c)),
                  )
                }
                placeholder={t('contactValue')}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setContacts(contacts.filter((_, i) => i !== index))}
              >
                {t('remove')}
              </Button>
            </div>
          ))}
          {contacts.length < 8 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setContacts([...contacts, { type: DEFAULT_CONTACT, value: '' }])}
            >
              {t('addContact')}
            </Button>
          ) : null}
        </fieldset>

        <div className={styles.actions}>
          <Button type="submit" disabled={save.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
