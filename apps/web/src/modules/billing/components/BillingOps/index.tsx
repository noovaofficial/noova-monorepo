'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { downloadTransactionsCsv, fetchBillingOperations } from '@/modules/billing/api';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './BillingOps.module.css';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Операции для админа (payments.md, этап 6): заказы на пополнение и
 * движения GlowCoin рядом, поиск по почте, номеру заказа и токену Paymento.
 * Ради одного вопроса — «я заплатил, а GlowCoin нет»: его разбирают, глядя
 * на заказ и журнал одновременно, а не в двух вкладках.
 */
export function BillingOps() {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();

  const [query, setQuery] = useState('');
  // Пауза перед запросом: без неё каждый символ в поиске уходит на сервер.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));

  const isAdmin = user?.role === 'admin';
  const ops = useQuery({
    queryKey: queryKeys.billingOperations(debounced),
    queryFn: () => fetchBillingOperations(debounced),
    enabled: status === 'authenticated' && isAdmin,
  });

  // Сохранение через ссылку на blob: сервер отдаёт файл, браузер его качает.
  const csv = useMutation({
    mutationFn: () => downloadTransactionsCsv(from, to),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `noova-glowcoin-${from}-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const data = ops.data;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('opsTitle')}</h1>
      <p className={styles.lead}>{t('opsLead')}</p>

      <input
        className={styles.search}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('opsSearch')}
      />

      {ops.isError ? <p className={styles.err}>{t('loadFailed')}</p> : null}
      {ops.isPending ? <p className={styles.empty}>{t('loading')}</p> : null}

      {data ? (
        <>
          <h2 className={styles.sectionTitle}>{t('opsOrders')}</h2>
          {data.orders.length === 0 ? (
            <p className={styles.text}>{t('opsEmpty')}</p>
          ) : (
            <div className={styles.list}>
              {data.orders.map((order) => (
                <div
                  className={`${styles.row} ${order.status === 'partial' ? styles.rowPartial : ''}`}
                  key={order.id}
                >
                  <div className={styles.main}>
                    <span className={styles.primary}>
                      {order.email ?? '—'} · {format.number(order.eurCents / 100)} € →{' '}
                      {format.number(order.grantedGc)} {t('ticker')}
                    </span>
                    <span className={styles.meta}>
                      {t('opsOrder')} {order.id}
                      {order.providerToken ? ` · ${t('opsToken')} ${order.providerToken}` : ''}
                      {order.providerStatus !== null
                        ? ` · ${t('opsProviderStatus', { code: order.providerStatus })}`
                        : ''}
                      {' · '}
                      {when(order.createdAt)}
                    </span>
                    {order.status === 'partial' ? (
                      <span className={styles.hint}>{t('opsPartialHint')}</span>
                    ) : null}
                  </div>
                  <span className={`${styles.badge} ${styles[`status_${order.status}`] ?? ''}`}>
                    {t(`orderStatus_${order.status}`)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <h2 className={styles.sectionTitle}>{t('opsTransactions')}</h2>
          {data.transactions.length === 0 ? (
            <p className={styles.text}>{t('opsEmpty')}</p>
          ) : (
            <div className={styles.list}>
              {data.transactions.map((tx) => (
                <div className={styles.row} key={tx.id}>
                  <div className={styles.main}>
                    <span className={styles.primary}>
                      {tx.email ?? '—'} · {t(`kind_${tx.kind}`)}
                    </span>
                    <span className={styles.meta}>
                      {when(tx.createdAt)}
                      {tx.note ? ` · ${tx.note}` : ''}
                      {tx.createdByEmail ? ` · ${t('opsBy', { email: tx.createdByEmail })}` : ''}
                      {tx.providerRef ? ` · ${t('opsToken')} ${tx.providerRef}` : ''}
                    </span>
                  </div>
                  <span className={`${styles.amount} ${tx.gcAmount > 0 ? styles.plus : ''}`}>
                    {tx.gcAmount > 0 ? '+' : ''}
                    {format.number(tx.gcAmount)} {t('ticker')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      <h2 className={styles.sectionTitle}>{t('opsCsvTitle')}</h2>
      <p className={styles.text}>{t('opsCsvHint')}</p>
      <div className={styles.csv}>
        <label className={styles.label}>
          {t('opsCsvFrom')}
          <input
            className={styles.date}
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className={styles.label}>
          {t('opsCsvTo')}
          <input
            className={styles.date}
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <Button disabled={csv.isPending || !from || !to} onClick={() => csv.mutate()}>
          {t('opsCsvButton')}
        </Button>
      </div>
      {csv.isError ? <p className={styles.err}>{t('opsCsvFailed')}</p> : null}
    </div>
  );
}
