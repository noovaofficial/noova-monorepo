'use client';

import {
  type AdminGlobalBilling,
  type GlobalBillingConfig,
  gcToEur,
  globalBillingConfigSchema,
  grantedGc,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { BillingError, fetchBillingConfig, saveBillingConfig } from '@/modules/billing/api';
import { useErrorText } from '@/shared/error-text';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './MonetizationSettings.module.css';

/** Поля держим строками: очищенный инпут — это пустая строка, а не ноль,
 *  и подставлять в него ноль на каждом стирании символа невозможно. */
const num = (value: string): number => Number(value.replace(',', '.')) || 0;

type FormState = {
  rate: string;
  tiers: { eur: string; bonus: string }[];
  /** Устаревшее поле (D-07 заменён сеткой тарифов агентств — см. страницу
   *  «Тарифы агентств», D-13). Здесь только для round-trip: схема сервера
   *  всё ещё требует его как аварийный fallback, но в форме его не видно. */
  agencyLimit: string;
  topShown: string;
  moderatorAdjustLimit: string;
};

function fromBook(book: AdminGlobalBilling): FormState {
  return {
    rate: String(book.gcPerEur),
    tiers: book.topupTiers.map((tier) => ({
      eur: String(tier.eur),
      bonus: String(tier.bonusPercent),
    })),
    agencyLimit: String(book.agencyProfileLimit),
    topShown: String(book.topShown),
    moderatorAdjustLimit: String(book.moderatorAdjustLimitGc),
  };
}

function toInput(form: FormState): GlobalBillingConfig {
  return {
    gcPerEur: num(form.rate),
    topupTiers: form.tiers.map((tier) => ({ eur: num(tier.eur), bonusPercent: num(tier.bonus) })),
    agencyProfileLimit: num(form.agencyLimit),
    topShown: num(form.topShown),
    moderatorAdjustLimitGc: num(form.moderatorAdjustLimit),
  };
}

/**
 * Общие настройки монетизации: курс, бонусная лестница и права сотрудников.
 * Цены размещения, ТОП и тарифы агентств заданы в стране и городе
 * (раздел «Локации»).
 *
 * По payments.md §5 это конфигурация (`PriceBook`, `TopupTier`), а не
 * константы в коде: курс, пороги и бонусы должны меняться без деплоя —
 * отсюда отдельный экран, а не правка файла.
 *
 * Только администратору: модератор разбирает очередь, а цены — решение
 * владельца продукта. Начисление за пополнение не хранится отдельным полем,
 * а считается из курса и бонуса — иначе здесь можно было бы сохранить
 * лестницу, где эти три числа не сходятся между собой.
 */
export function MonetizationSettings() {
  const t = useTranslations('billing');
  const explain = useErrorText();
  const { user, status } = useSession();
  const router = useRouter();

  const isAdmin = user?.role === 'admin';
  const config = useQuery({
    queryKey: queryKeys.billingConfig(),
    queryFn: fetchBillingConfig,
    enabled: status === 'authenticated' && isAdmin,
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  if (config.isError)
    return <p className={styles.empty}>{explain(config.error, t('loadFailed'))}</p>;
  if (!config.data) return <p className={styles.empty}>{t('loading')}</p>;

  // Форма получает начальное состояние через ключ, а не через эффект:
  // повторная загрузка с сервера пересоздаёт её с новыми значениями, и
  // синхронизировать состояние с ответом руками не нужно.
  return <MonetizationForm key={config.dataUpdatedAt} initial={config.data} />;
}

function MonetizationForm({ initial }: { initial: AdminGlobalBilling }) {
  const t = useTranslations('billing');
  const explain = useErrorText();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(() => fromBook(initial));
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: saveBillingConfig,
    onSuccess: async (book) => {
      queryClient.setQueryData(queryKeys.billingConfig(), book);
      // Кошелёк рекламодателя читает тот же прайс другим ключом.
      await queryClient.invalidateQueries({ queryKey: queryKeys.priceBook() });
    },
  });

  const gcPerEur = num(form.rate);

  const setTier = (index: number, field: 'eur' | 'bonus', value: string) =>
    setForm((prev) => ({
      ...prev,
      tiers: prev.tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)),
    }));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Проверяем той же схемой, что и сервер: ошибка называется до запроса,
    // а не приходит обратно безликим 400.
    const parsed = globalBillingConfigSchema.safeParse(toInput(form));
    setInvalid(!parsed.success);
    if (parsed.success) save.mutate(parsed.data);
  }

  const failed = save.isError && !(save.error instanceof BillingError && save.error.status === 400);
  const rejected = save.isError && !failed;

  return (
    <form className={styles.wrap} onSubmit={onSubmit}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('monetizationTitle')}</h1>
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
      </div>
      <p className={styles.lead}>{t('monetizationLead')}</p>

      {save.isSuccess && !save.isPending ? (
        <p className={`${styles.notice} ${styles.noticeOk}`}>{t('saved')}</p>
      ) : null}
      {invalid || rejected ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('invalidConfig')}</p>
      ) : null}
      {failed ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>
          {explain(save.error, t('saveFailed'))}
        </p>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('currencySection')}</h2>
        <p className={styles.hint}>{t('currencyHint')}</p>

        <div className={styles.currencyRow}>
          <div className={styles.field}>
            <span className={styles.label}>{t('fieldName')}</span>
            <span className={styles.static}>GlowCoin</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('fieldTicker')}</span>
            <span className={styles.static}>{t('ticker')}</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="gc-rate">
              {t('fieldRate')}
            </label>
            <input
              className={styles.input}
              id="gc-rate"
              inputMode="decimal"
              value={form.rate}
              onChange={(event) => setForm((prev) => ({ ...prev, rate: event.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('tiersSection')}</h2>
        <p className={styles.hint}>{t('tiersHint')}</p>

        <div className={`${styles.grid} ${styles.tiers}`}>
          <div className={styles.gridHead}>{t('colTopup')}</div>
          <div className={styles.gridHead}>{t('colBonus')}</div>
          <div className={styles.gridHead}>{t('colGranted')}</div>
          <div className={styles.gridHead}>{t('colRate')}</div>

          {form.tiers.map((tier, index) => {
            const eur = num(tier.eur);
            const granted = grantedGc(eur, num(tier.bonus), gcPerEur);
            return (
              // Ключ по позиции: сумма порога — редактируемое поле, и на
              // полустёртом значении два порога совпадут.
              // biome-ignore lint/suspicious/noArrayIndexKey: строки лестницы не переставляются
              <div className={styles.rowGroup} key={index}>
                <div className={styles.field}>
                  <span className={styles.cellLabel}>{t('colTopup')}</span>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    aria-label={t('colTopup')}
                    value={tier.eur}
                    onChange={(event) => setTier(index, 'eur', event.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.cellLabel}>{t('colBonus')}</span>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    aria-label={t('colBonus')}
                    value={tier.bonus}
                    onChange={(event) => setTier(index, 'bonus', event.target.value)}
                  />
                </div>
                <div className={styles.computed}>
                  <span className={styles.cellLabel}>{t('colGranted')}</span>
                  {granted} {t('ticker')}
                </div>
                <div className={styles.computed}>
                  <span className={styles.cellLabel}>{t('colRate')}</span>
                  {eur > 0 ? t('gcPerEur', { rate: granted / eur }) : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Права сотрудников — не тариф, поэтому отдельным разделом, а не
          строкой среди цен: правят его по другому поводу и заметно реже. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('staffSection')}</h2>
        <p className={styles.hint}>{t('moderatorAdjustHint')}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="moderator-adjust-limit">
            {t('moderatorAdjustLimit')}
          </label>
          <input
            className={`${styles.input} ${styles.narrow}`}
            id="moderator-adjust-limit"
            inputMode="numeric"
            value={form.moderatorAdjustLimit}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, moderatorAdjustLimit: event.target.value }))
            }
          />
          <span className={styles.hint}>
            {t('moderatorAdjustLimitEur', {
              amount: gcToEur(num(form.moderatorAdjustLimit), gcPerEur),
            })}
          </span>
        </div>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('topSection')}</h2>
        <p className={styles.hint}>{t('topShownHint')}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="top-shown">
            {t('topShownLabel')}
          </label>
          <input
            className={`${styles.input} ${styles.narrow}`}
            id="top-shown"
            inputMode="numeric"
            value={form.topShown}
            onChange={(event) => setForm((prev) => ({ ...prev, topShown: event.target.value }))}
          />
        </div>
      </section>
    </form>
  );
}
