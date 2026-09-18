'use client';

import type { Company, CompanyInput, ContactInput, PaymentMethod } from '@noova/shared';
import { companyInputSchema, SPOKEN_LANGUAGES } from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import {
  AccountError,
  deleteCompanyLogo,
  fetchOwnCompany,
  saveOwnCompany,
  uploadCompanyLogo,
} from '@/modules/account/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { AgencyTopCard } from '@/modules/billing/components/AgencyTopCard';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';
import { ContactPicker } from '../ContactPicker';
import linkStyles from './CompanyEditor.module.css';

const PAYMENTS: PaymentMethod[] = ['cash', 'card', 'transfer'];
const FORM_ID = 'company-editor-form';

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
    <path strokeLinecap="round" d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path strokeLinecap="round" d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

type Notice = { kind: 'ok' | 'error'; text: string } | null;

/**
 * Данные агентства в кабинете (N-33).
 *
 * Компания есть только у агентства: салон — это анкета, и его адрес, часы и
 * удобства живут в форме анкеты, а не здесь (N-34).
 *
 * Одна компания на учётную запись, поэтому здесь нет списка и выбора: форма
 * либо заводит её, либо правит. Тип не выбирается — он взят из типа учётной
 * записи при регистрации. Разметка нарочно повторяет `ProfileEditor`: те же
 * карточки-секции и та же липкая боковая панель с действием — форма
 * агентства не должна выглядеть как другой продукт.
 */
export function CompanyEditor() {
  const t = useTranslations('company');
  const tLang = useTranslations('languageNames');
  const locale = useLocale();
  const { user, status } = useSession();
  const queryClient = useQueryClient();

  const allowed = user?.advertiserKind === 'agency';

  const query = useQuery({
    queryKey: queryKeys.ownCompany(),
    queryFn: fetchOwnCompany,
    enabled: allowed,
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [contacts, setContacts] = useState<ContactInput[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState(false);

  // Данные приходят запросом: до его завершения полей нет, и без синхронизации
  // форма осталась бы пустой поверх уже заведённой компании.
  useEffect(() => {
    const company = query.data;
    if (!company) return;
    setSlug(company.slug);
    setName(company.name);
    setDescription(company.description ?? '');
    setWebsite(company.website ?? '');
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
        website: website.trim() || undefined,
        languages,
        payments,
        contacts: contacts.filter((c) => c.value.trim() !== ''),
        isActive: true,
      });
      return saveOwnCompany(input);
    },
    onSuccess: () => {
      setNotice({ kind: 'ok', text: t('saved') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ownCompany() });
    },
    onError: (cause: unknown) => {
      // Сообщение сервера показываем как есть: в нём сказано, что именно
      // не так — занятый адрес, несовпадение типа, слишком короткое имя.
      setNotice({
        kind: 'error',
        text: cause instanceof AccountError && cause.message ? cause.message : t('failed'),
      });
    },
  });

  const logoUpload = useMutation({
    mutationFn: uploadCompanyLogo,
    onSuccess: ({ logoUrl }) => {
      queryClient.setQueryData<Company | null>(queryKeys.ownCompany(), (prev) =>
        prev ? { ...prev, logoUrl } : prev,
      );
    },
  });

  const logoRemove = useMutation({
    mutationFn: deleteCompanyLogo,
    onSuccess: () => {
      queryClient.setQueryData<Company | null>(queryKeys.ownCompany(), (prev) =>
        prev ? { ...prev, logoUrl: null } : prev,
      );
    },
  });

  function onPickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Сбрасываем input сразу: иначе повторный выбор того же файла не
    // вызовет событие change.
    event.target.value = '';
    if (file) logoUpload.mutate(file);
  }

  async function copyLink() {
    if (!query.data) return;
    const url = `${window.location.origin}/${locale}/company/${query.data.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер обмена недоступен (нет разрешения, не HTTPS) — ссылка всё
      // равно видна и её можно выделить руками.
    }
  }

  if (status === 'loading') return <p className={styles.empty}>…</p>;
  if (!allowed) return <p className={styles.empty}>{t('onlyCompanies')}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('cabinetAgency')}</h1>
      </div>

      <div className={styles.layout}>
        <form
          className={styles.form}
          id={FORM_ID}
          onSubmit={(event) => {
            event.preventDefault();
            try {
              save.mutate();
            } catch {
              setNotice({ kind: 'error', text: t('checkFields') });
            }
          }}
        >
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('logo')}</h2>
            <span className={styles.hint}>{t('logoHint')}</span>

            {query.data ? (
              <div className={linkStyles.logoRow}>
                {query.data.logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: превью уже готового публичного webp, оптимизировать нечего
                  <img className={linkStyles.logoPreview} src={query.data.logoUrl} alt="" />
                ) : (
                  <div className={linkStyles.logoPlaceholder} />
                )}
                <div>
                  <label className={styles.uploadLabel} htmlFor="company-logo">
                    {logoUpload.isPending ? t('logoUploading') : t('uploadLogo')}
                  </label>
                  <input
                    className={styles.uploadInput}
                    id="company-logo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    onChange={onPickLogo}
                    disabled={logoUpload.isPending || logoRemove.isPending}
                  />
                  {query.data.logoUrl ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={logoUpload.isPending || logoRemove.isPending}
                      onClick={() => logoRemove.mutate()}
                    >
                      {t('removeLogo')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <span className={styles.hint}>{t('logoNeedsCompany')}</span>
            )}
            {logoUpload.isError || logoRemove.isError ? (
              <p className={`${styles.notice} ${styles.noticeError}`}>{t('logoFailed')}</p>
            ) : null}
          </div>

          <div className={styles.section}>
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
                maxLength={4000}
              />
              <span className={styles.hint}>{t('descriptionHint')}</span>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="company-website">
                {t('website')}
              </label>
              <input
                className={styles.input}
                id="company-website"
                type="text"
                inputMode="url"
                placeholder="example.com"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                maxLength={300}
              />
              <span className={styles.hint}>{t('websiteHint')}</span>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('languages')}</h2>

            <div className={styles.serviceGrid}>
              {SPOKEN_LANGUAGES.map((code) => {
                const checked = languages.includes(code);
                return (
                  <label
                    className={`${styles.serviceRow} ${checked ? styles.serviceRowChecked : ''}`}
                    key={code}
                    htmlFor={`company-lang-${code}`}
                  >
                    <span className={styles.serviceLabel}>
                      <input
                        id={`company-lang-${code}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setLanguages((current) =>
                            current.includes(code)
                              ? current.filter((value) => value !== code)
                              : SPOKEN_LANGUAGES.filter(
                                  (value) => value === code || current.includes(value),
                                ),
                          )
                        }
                      />
                      <span className={styles.serviceName}>
                        {tLang.has(code) ? tLang(code) : code}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('payments')}</h2>
            <fieldset className={styles.field}>
              <div className={styles.checkRow}>
                {PAYMENTS.map((method) => (
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
                    {t(`payment_${method}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <ContactPicker contacts={contacts} onChange={setContacts} />
        </form>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarCard}>
            <span className={styles.sidebarTitle}>{t('publicLinkTitle')}</span>

            {query.data ? (
              <div className={linkStyles.linkBox}>
                <LinkIcon />
                <Link
                  className={linkStyles.linkText}
                  href={`/company/${query.data.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  /company/{query.data.slug}
                </Link>
                <Button
                  type="button"
                  variant="icon"
                  onClick={copyLink}
                  aria-label={t('copyLink')}
                  title={t('copyLink')}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </Button>
              </div>
            ) : (
              <span className={styles.hint}>{t('notCreated')}</span>
            )}
            {copied ? <span className={styles.hint}>{t('linkCopied')}</span> : null}
          </div>

          {/* ТОП — только когда компания уже заведена: без сохранённой
              записи покупать ещё нечего (payments.md §3.5, D-14). */}
          {query.data ? <AgencyTopCard /> : null}

          <div className={styles.sidebarCard}>
            {notice ? (
              <p
                className={`${styles.notice} ${notice.kind === 'ok' ? styles.noticeOk : styles.noticeError}`}
                style={{ margin: 0 }}
              >
                {notice.text}
              </p>
            ) : null}
            <div className={styles.sidebarActions}>
              <Button type="submit" form={FORM_ID} disabled={save.isPending}>
                {t('save')}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
