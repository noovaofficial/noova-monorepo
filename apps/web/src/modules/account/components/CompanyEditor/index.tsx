'use client';

import {
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
const PAYMENTS: PaymentMethod[] = ['cash', 'card', 'transfer'];

/**
 * Данные агентства в кабинете (N-33).
 *
 * Компания есть только у агентства: салон — это анкета, и его адрес, часы и
 * удобства живут в форме анкеты, а не здесь (N-34).
 *
 * Одна компания на учётную запись, поэтому здесь нет списка и выбора: форма
 * либо заводит её, либо правит. Тип не выбирается — он взят из типа учётной
 * записи при регистрации.
 */
export function CompanyEditor() {
  const t = useTranslations('company');
  const tLang = useTranslations('languageNames');
  const { user, status } = useSession();
  const queryClient = useQueryClient();

  const allowed = user?.advertiserKind === 'agency';

  const query = useQuery({
    queryKey: queryKeys.ownCompany(),
    queryFn: fetchOwnCompany,
    enabled: allowed,
  });

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
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
    setLanguages(company.languages);
    setPayments(company.payments);
    setContacts(company.contacts);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      const input: CompanyInput = companyInputSchema.parse({
        slug,
        kind: 'agency',
        name,
        description: description.trim() || undefined,
        languages,
        payments,
        contacts: contacts.filter((c) => c.value.trim() !== ''),
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

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('cabinetAgency')}</h1>
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
          <span className={styles.hint}>{t('nameHint')}</span>
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
          <span className={styles.hint}>{t('descriptionHint')}</span>
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
            {PAYMENTS.map((method) => (
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
                title={t('contactValueHint')}
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
