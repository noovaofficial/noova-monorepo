'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchTopupOrder } from '@/modules/billing/api';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../GlowCoinWallet/GlowCoinWallet.module.css';

const TERMINAL = new Set(['paid', 'expired', 'canceled', 'failed']);

/**
 * Страница возврата с кассы. Возврат — навигация, а не факт оплаты:
 * зачисление приходит колбэком, когда сеть подтвердит блок. Пока его нет,
 * опрашиваем заказ раз в несколько секунд; страницу можно закрыть — GlowCoin
 * зачислятся без неё.
 */
export function TopupStatus({ orderId }: { orderId: string }) {
  const t = useTranslations('billing');
  const format = useFormatter();

  const order = useQuery({
    queryKey: queryKeys.topupOrder(orderId),
    queryFn: () => fetchTopupOrder(orderId),
    refetchInterval: (query) =>
      query.state.data && TERMINAL.has(query.state.data.status) ? false : 4000,
  });

  const data = order.data;

  return (
    <div className={styles.checkout}>
      <h1 className={styles.title}>{t('checkoutTitle')}</h1>

      {order.isError ? <p className={styles.err}>{t('checkoutMissing')}</p> : null}
      {order.isPending ? <p className={styles.text}>{t('loading')}</p> : null}

      {data ? (
        <>
          <div className={styles.checkoutSum}>
            {format.number(data.grantedGc)} {t('ticker')}
          </div>
          <p className={styles.text}>{t('packPrice', { amount: data.eurCents / 100 })}</p>

          {data.status === 'paid' ? (
            <p className={styles.ok}>{t('checkoutPaid', { gc: data.grantedGc })}</p>
          ) : data.status === 'expired' ? (
            <p className={styles.err}>{t('checkoutExpired')}</p>
          ) : data.status === 'canceled' ? (
            <p className={styles.err}>{t('checkoutCanceled')}</p>
          ) : data.status === 'failed' ? (
            <p className={styles.err}>{t('checkoutFailed')}</p>
          ) : (
            <p className={styles.note}>{t('checkoutWaiting')}</p>
          )}
        </>
      ) : null}

      <Link className={styles.back} href="/account/glowcoin">
        {t('checkoutBack')}
      </Link>
    </div>
  );
}
