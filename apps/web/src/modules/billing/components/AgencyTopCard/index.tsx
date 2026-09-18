'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import {
  BillingError,
  buyAgencyTop,
  fetchAgencyTopState,
  fetchWallet,
} from '@/modules/billing/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './AgencyTopCard.module.css';

/**
 * Карточка ТОПа агентств в редакторе компании (payments.md §3.5, D-14) —
 * зеркало `TopCard` для анкеты. Своей компании ещё нет (форма ещё не
 * сохранялась) — карточка не рендерится вовсе, звать её рано.
 */
export function AgencyTopCard() {
  const t = useTranslations('billing');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [doneUntil, setDoneUntil] = useState<string | null>(null);

  const top = useQuery({ queryKey: queryKeys.agencyTop(), queryFn: fetchAgencyTopState });
  const wallet = useQuery({ queryKey: queryKeys.wallet(), queryFn: fetchWallet });

  const buy = useMutation({
    mutationFn: () => buyAgencyTop(),
    // Отказ означает, что состояние на экране устарело: место могли занять
    // или неделя уже куплена в другой вкладке. Перечитываем — карточка
    // перерисуется сама.
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.agencyTop() }),
    onSuccess: async (result) => {
      setConfirming(false);
      setDoneUntil(result.placement.expiresAt);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agencyTop() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.wallet() }),
      ]);
    },
  });

  if (!top.data) return null;

  const { placement } = top.data;
  const price = top.data.priceGc;
  const balance = wallet.data?.balanceGc;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });
  // Активное место — покупка недоступна (D-11), как и без единой
  // опубликованной анкеты (то же правило, что и у ТОПа анкет, D-10).
  const canBuy = top.data.hasPublishedProfile && placement === null && top.data.freeSlots > 0;

  const errorKey =
    buy.error instanceof BillingError
      ? buy.error.status === 409
        ? 'topFull'
        : buy.error.status === 402
          ? 'topNotEnoughShort'
          : 'topFailed'
      : buy.isError
        ? 'topFailed'
        : null;

  return (
    <div className={styles.card}>
      <span className={styles.title}>{t('agencyTopTitle')}</span>

      {placement ? (
        <p className={styles.active}>
          {t('agencyTopActiveUntil', { date: date(placement.expiresAt) })}
        </p>
      ) : null}

      <p className={styles.text}>
        {t('agencyTopText', { slots: top.data.slots, price })}{' '}
        {placement
          ? t('topActiveHint')
          : t('topFree', { free: top.data.freeSlots, slots: top.data.slots })}
      </p>

      {doneUntil ? (
        <p className={styles.ok}>{t('agencyTopDone', { date: date(doneUntil) })}</p>
      ) : null}
      {errorKey ? <p className={styles.err}>{t(errorKey)}</p> : null}

      {!top.data.hasPublishedProfile ? (
        <p className={styles.hint}>{t('agencyTopNoProfiles')}</p>
      ) : null}
      {top.data.hasPublishedProfile && !placement && top.data.freeSlots === 0 ? (
        <p className={styles.hint}>{t('topFull')}</p>
      ) : null}

      {canBuy && !confirming ? (
        <Button
          variant="secondary"
          onClick={() => {
            setConfirming(true);
            setDoneUntil(null);
          }}
        >
          {t('topBuy', { price })}
        </Button>
      ) : null}

      {canBuy && confirming ? (
        <div className={styles.confirm}>
          {balance !== undefined && balance >= price ? (
            <>
              <span>{t('activateConfirm', { gc: price, rest: balance - price })}</span>
              <div className={styles.actions}>
                <Button disabled={buy.isPending} onClick={() => buy.mutate()}>
                  {t('topBuySubmit')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={buy.isPending}
                  onClick={() => setConfirming(false)}
                >
                  {t('cancel')}
                </Button>
              </div>
            </>
          ) : balance !== undefined ? (
            <span>
              {t('activateNotEnough', { gc: price - balance })}{' '}
              <Link className={styles.link} href="/account/glowcoin">
                {t('subscriptionWallet')}
              </Link>
            </span>
          ) : (
            <span>{t('loading')}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
