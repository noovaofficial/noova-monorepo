'use client';

import {
  effectiveTierPriceGc,
  gcToEur,
  PLAN_TERMS,
  type PlanTerm,
  TERM_MONTHS,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { fetchOwnCompanyTariff } from '@/modules/agencies/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { activateListing, fetchListing, fetchPriceBook, fetchWallet } from '@/modules/billing/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './SubscriptionPanel.module.css';

const TERM_LABEL: Record<PlanTerm, 'term1' | 'term6' | 'term12'> = {
  m1: 'term1',
  m6: 'term6',
  m12: 'term12',
};

const ADVERTISER_LABEL = {
  individual: 'advertiserIndividual',
  salon: 'advertiserSalon',
  agency: 'advertiserAgency',
} as const;

/** Сколько полных суток осталось до даты. Ноль — если срок уже вышел. */
function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/**
 * Подписка: текущий срок и его продление. Отдельная страница, а не раздел
 * настроек или кошелька: срок размещения — то, ради чего рекламодатель
 * заходит в кабинет, и он не должен искать его среди удаления учётки или
 * пакетов пополнения. Кошелёк остаётся про деньги: баланс, пополнение,
 * история.
 */
export function SubscriptionPanel() {
  const t = useTranslations('billing');
  // Тип размещения подписан так же, как при регистрации: человек выбирал
  // его там, и синоним читался бы как другой тариф.
  const ta = useTranslations('auth');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const isAdvertiser = user?.role === 'advertiser';
  // У агентства цена не общая, а по тарифу, назначенному компании (см.
  // billing/agency-tariffs.ts `resolveAgencyListingPriceGc`, которым и
  // реально считается списание). Общий прайс тогда служит только фоллбэком.
  const isAgency = isAdvertiser && user?.advertiserKind === 'agency';
  const listing = useQuery({
    queryKey: queryKeys.listing(),
    queryFn: fetchListing,
    enabled: isAdvertiser,
  });
  const book = useQuery({
    queryKey: queryKeys.priceBook(),
    queryFn: fetchPriceBook,
    enabled: isAdvertiser,
    staleTime: 60 * 1000,
  });
  const tariff = useQuery({
    queryKey: queryKeys.ownCompanyTariff(),
    queryFn: fetchOwnCompanyTariff,
    enabled: isAgency,
  });
  const wallet = useQuery({
    queryKey: queryKeys.wallet(),
    queryFn: fetchWallet,
    enabled: isAdvertiser,
  });

  const [term, setTerm] = useState<PlanTerm | null>(null);
  const [activatedUntil, setActivatedUntil] = useState<string | null>(null);

  const activate = useMutation({
    mutationFn: activateListing,
    onSuccess: async (result) => {
      setTerm(null);
      setActivatedUntil(result.listing.expiresAt);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.listing() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.wallet() }),
      ]);
    },
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdvertiser || !user.advertiserKind) {
    return <p className={styles.empty}>{t('onlyAdvertisers')}</p>;
  }

  const current = listing.data ?? null;
  const isExtension = current?.status === 'active';
  const gcPerEur = book.data?.gcPerEur;
  const balance = wallet.data?.balanceGc;
  // Индивидуальные условия — это override админа (лимит и/или цена сверх
  // тарифа), а не просто «не тариф по умолчанию»: обычное самостоятельное
  // повышение на больший тариф из сетки индивидуальным не является.
  const hasCustomTariff =
    tariff.data != null &&
    (tariff.data.customProfileLimit !== null ||
      Object.values(tariff.data.customPrices).some((value) => value !== null));
  // Агентство — цена по его тарифу (с учётом индивидуального override), а не
  // из общего прайса: тариф с сеткой по числу анкет заменяет плоскую цену
  // для агентств (payments.md §3.3, D-13). Пока свой тариф не загрузился,
  // цену не показываем вовсе — общая цифра здесь была бы неправильной.
  const prices =
    isAgency && book.data
      ? tariff.data
        ? (Object.fromEntries(
            PLAN_TERMS.map((planTerm) => [
              planTerm,
              effectiveTierPriceGc(
                planTerm,
                tariff.data.tariffTier,
                tariff.data.customPrices,
                book.data.prices.agency[planTerm],
              ),
            ]),
          ) as Record<PlanTerm, number>)
        : undefined
      : book.data?.prices[user.advertiserKind];
  const price = term && prices ? prices[term] : null;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('subscriptionTitle')}</h1>

      <div className={styles.card}>
        {listing.isPending ? <p className={styles.text}>{t('loading')}</p> : null}
        {listing.isError ? <p className={styles.err}>{t('loadFailed')}</p> : null}

        {(listing.isSuccess && current) || (isAgency && tariff.data) ? (
          <dl className={styles.rows}>
            {/* Тариф — по своему ряду, независимо от того, есть ли уже
                активное размещение: агентству нужно видеть его до оплаты, а
                не только после. */}
            {isAgency && tariff.data ? (
              <div className={styles.row}>
                <dt className={styles.rowLabel}>{t('subscriptionTariff')}</dt>
                <dd className={styles.rowValue}>
                  {/* Название тарифа из сетки ("До 8 анкет" и т. п.) при
                      индивидуальном override не показываем совсем: оно несёт
                      значение из сетки, которое override уже перекрыл, и
                      рядом с реальным лимитом выглядело бы противоречиво. */}
                  {hasCustomTariff
                    ? t('subscriptionTariffCustom')
                    : (tariff.data.tariffTier?.name ?? t('subscriptionTariffNone'))}
                  {tariff.data.tariffTier ? (
                    <span className={styles.rowHint}>
                      {' '}
                      · {t('subscriptionTariffLimit', { limit: tariff.data.effectiveLimit })}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}

            {current ? (
              <>
                <div className={styles.row}>
                  <dt className={styles.rowLabel}>{t('subscriptionPlan')}</dt>
                  <dd className={styles.rowValue}>{ta(ADVERTISER_LABEL[user.advertiserKind])}</dd>
                </div>

                {/* Дата и остаток вместе: «до 15 января» без «осталось 12
                    дней» требует считать в уме, а одни «12 дней» нечем
                    проверить. */}
                <div className={styles.row}>
                  <dt className={styles.rowLabel}>{t('subscriptionUntil')}</dt>
                  <dd className={styles.rowValue}>
                    {format.dateTime(new Date(current.expiresAt), { dateStyle: 'long' })}
                    <span className={styles.rowHint}>
                      {' '}
                      · {t('subscriptionDaysLeft', { days: daysLeft(current.expiresAt) })}
                    </span>
                  </dd>
                </div>

                {current.status !== 'active' ? (
                  <div className={styles.row}>
                    <dt className={styles.rowLabel}>{t('subscriptionStatus')}</dt>
                    <dd className={styles.rowValue}>{t(`subscriptionStatus_${current.status}`)}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        ) : null}

        {listing.isSuccess && !current ? (
          <p className={styles.text}>{t('subscriptionNone')}</p>
        ) : null}
      </div>

      <h2 className={styles.sectionTitle}>
        {t(isExtension ? 'activateExtendTitle' : 'activateTitle')}
      </h2>
      <p className={styles.text}>{t(isExtension ? 'activateExtendHint' : 'activateText')}</p>

      {activatedUntil ? (
        <p className={styles.ok}>
          {t('activateDone', {
            date: format.dateTime(new Date(activatedUntil), { dateStyle: 'long' }),
          })}
        </p>
      ) : null}
      {activate.isError ? <p className={styles.err}>{t('activateFailed')}</p> : null}

      {prices && gcPerEur ? (
        <div className={styles.terms}>
          {PLAN_TERMS.map((option) => (
            <button
              type="button"
              key={option}
              className={`${styles.term} ${term === option ? styles.termSelected : ''}`}
              aria-pressed={term === option}
              onClick={() => {
                setTerm(option);
                setActivatedUntil(null);
              }}
            >
              <span className={styles.termName}>{t(TERM_LABEL[option])}</span>
              <span className={styles.termPrice}>{t('termPrice', { gc: prices[option] })}</span>
              <span className={styles.termMonthly}>
                {t('termMonthly', {
                  amount: gcToEur(prices[option], gcPerEur) / TERM_MONTHS[option],
                })}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Списываемая сумма и остаток после — до нажатия, а не после (§6):
          человек должен видеть, что останется, пока ещё может передумать. */}
      {term && price !== null && balance !== undefined ? (
        <div className={styles.confirm}>
          {balance >= price ? (
            <>
              <span>{t('activateConfirm', { gc: price, rest: balance - price })}</span>
              <Button disabled={activate.isPending} onClick={() => activate.mutate(term)}>
                {t(isExtension ? 'activateExtendSubmit' : 'activateSubmit')}
              </Button>
            </>
          ) : (
            <span>
              {t('activateNotEnough', { gc: price - balance })}{' '}
              <Link className={styles.link} href="/account/glowcoin">
                {t('subscriptionWallet')}
              </Link>
            </span>
          )}
        </div>
      ) : null}

      <p className={styles.text}>
        {balance !== undefined ? (
          <>
            {t('balanceLabel')}: {format.number(balance)} {t('ticker')} ·{' '}
          </>
        ) : null}
        <Link className={styles.link} href="/account/glowcoin">
          {t('subscriptionWallet')}
        </Link>
      </p>
    </div>
  );
}
