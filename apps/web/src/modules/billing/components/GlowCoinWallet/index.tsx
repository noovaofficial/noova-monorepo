'use client';

import { type CreateTopupInput, gcToEur } from '@noova/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { BillingError, createTopup, fetchPriceBook, fetchWallet } from '@/modules/billing/api';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import { GlowCoinIcon } from '../GlowCoinIcon';
import styles from './GlowCoinWallet.module.css';

/**
 * Кошелёк: баланс, пополнение и история операций. Раздел только для тех,
 * кто размещается: у клиента каталога тратить GlowCoin негде, и кошелёк в
 * его меню был бы обещанием покупки, которая ему ничего не даёт.
 *
 * Срок размещения и его продление живут на отдельной странице подписки:
 * кошелёк — про деньги, подписка — про то, на что они тратятся.
 *
 * Пакеты и курс приходят с сервера — те же, что правит админ. Пополнение
 * создаёт заказ и уводит на шлюз Paymento; зачисление приходит колбэком,
 * когда сеть подтвердит блок.
 */
export function GlowCoinWallet() {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();
  const locale = useLocale();

  const isAdvertiser = user?.role === 'advertiser';
  const book = useQuery({
    queryKey: queryKeys.priceBook(),
    queryFn: fetchPriceBook,
    enabled: isAdvertiser,
    staleTime: 60 * 1000,
  });
  const wallet = useQuery({
    queryKey: queryKeys.wallet(),
    queryFn: fetchWallet,
    enabled: isAdvertiser,
  });

  // Заказ создан — уходим на шлюз всей вкладкой: касса — чужой сайт, и
  // возвращает он на страницу заказа, а не сюда.
  const topup = useMutation({
    mutationFn: (eur: number) => createTopup({ eur, locale: locale as CreateTopupInput['locale'] }),
    onSuccess: (result) => {
      window.location.assign(result.paymentUrl);
    },
  });
  const topupUnavailable =
    topup.isError && topup.error instanceof BillingError && topup.error.status === 503;

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (!isAdvertiser) return <p className={styles.empty}>{t('onlyAdvertisers')}</p>;

  const gcPerEur = book.data?.gcPerEur;
  const balance = wallet.data?.balanceGc;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('walletTitle')}</h1>

      <div className={styles.balance}>
        <GlowCoinIcon className={styles.balanceIcon} size={44} />
        <div>
          <div className={styles.balanceLabel}>{t('balanceLabel')}</div>
          <div className={styles.balanceValue}>
            {balance === undefined ? '…' : format.number(balance)} {t('ticker')}
          </div>
          {balance !== undefined && gcPerEur ? (
            <div className={styles.balanceEur}>
              {t('balanceEur', { amount: gcToEur(balance, gcPerEur) })}
            </div>
          ) : null}
        </div>
      </div>

      {wallet.isError || book.isError ? <p className={styles.err}>{t('loadFailed')}</p> : null}

      <p className={styles.current}>
        <Link className={styles.back} href="/account/subscription">
          {t('walletSubscriptionLink')}
        </Link>
      </p>

      <h2 className={styles.sectionTitle}>{t('topupTitle')}</h2>
      <p className={styles.text}>{t('topupText')}</p>

      {topup.isPending || topup.isSuccess ? (
        <p className={styles.note}>{t('topupRedirect')}</p>
      ) : null}
      {topupUnavailable ? <p className={styles.err}>{t('topupUnavailable')}</p> : null}
      {topup.isError && !topupUnavailable ? <p className={styles.err}>{t('topupFailed')}</p> : null}

      {book.isPending ? <p className={styles.empty}>{t('loading')}</p> : null}

      {book.data ? (
        <div className={styles.packs}>
          {book.data.topupTiers.map((pack) => (
            <button
              type="button"
              className={`${styles.pack} ${styles.packButton}`}
              key={pack.eur}
              disabled={topup.isPending || topup.isSuccess}
              onClick={() => topup.mutate(pack.eur)}
            >
              {pack.bonusPercent > 0 ? (
                <span className={styles.packBonus}>
                  {t('bonus', { percent: pack.bonusPercent })}
                </span>
              ) : null}
              <span className={styles.packGc}>
                {format.number(pack.grantedGc)} {t('ticker')}
              </span>
              <span className={styles.packEur}>{t('packPrice', { amount: pack.eur })}</span>
              {/* Эффективный курс — то, ради чего лестница и существует:
                  без него «+40%» приходится пересчитывать в уме. */}
              <span className={styles.packRate}>
                {t('packRate', { rate: pack.grantedGc / pack.eur })}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <p className={styles.text}>{t('spendHint')}</p>

      <h2 className={styles.sectionTitle}>{t('historyTitle')}</h2>
      {wallet.data ? (
        wallet.data.transactions.length === 0 ? (
          <p className={styles.text}>{t('historyEmpty')}</p>
        ) : (
          <div className={styles.history}>
            {wallet.data.transactions.map((tx) => (
              <div className={styles.tx} key={tx.id}>
                <div className={styles.txMain}>
                  <span className={styles.txKind}>{t(`kind_${tx.kind}`)}</span>
                  {tx.note ? <span className={styles.txNote}>{tx.note}</span> : null}
                  <span className={styles.txDate}>
                    {format.dateTime(new Date(tx.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                {/* Знак пишем сами: у списания он и так есть, а «+» перед
                    пополнением превращает список в понятную выписку. */}
                <span
                  className={`${styles.txAmount} ${tx.gcAmount > 0 ? styles.txPlus : styles.txMinus}`}
                >
                  {tx.gcAmount > 0 ? '+' : ''}
                  {format.number(tx.gcAmount)} {t('ticker')}
                </span>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
