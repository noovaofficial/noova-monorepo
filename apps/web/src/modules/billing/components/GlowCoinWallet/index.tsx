'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { MOCK_BALANCE_GC } from '@/modules/billing/mock';
import { checkoutUrl, gcToEur, TOPUP_PACKS } from '@/modules/billing/pricing';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { GlowCoinIcon } from '../GlowCoinIcon';
import styles from './GlowCoinWallet.module.css';

/**
 * Баланс и пополнение. Раздел только для тех, кто размещается: у клиента
 * каталога тратить GlowCoin негде, и кошелёк в его меню был бы обещанием
 * покупки, которая ему ничего не даёт.
 *
 * Кнопки пока ведут на внутреннюю заглушку кассы — платёжного провайдера нет.
 * Баланс тоже подставной (см. `billing/mock.ts`).
 */
export function GlowCoinWallet() {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { user, status } = useSession();
  const router = useRouter();

  if (status === 'loading') return <p className={styles.empty}>{t('loading')}</p>;

  if (status === 'anonymous') {
    router.replace('/login');
    return null;
  }

  if (user?.role !== 'advertiser') return <p className={styles.empty}>{t('onlyAdvertisers')}</p>;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('walletTitle')}</h1>

      <div className={styles.balance}>
        <GlowCoinIcon className={styles.balanceIcon} size={44} />
        <div>
          <div className={styles.balanceLabel}>{t('balanceLabel')}</div>
          <div className={styles.balanceValue}>
            {format.number(MOCK_BALANCE_GC)} {t('ticker')}
          </div>
          <div className={styles.balanceEur}>
            {t('balanceEur', { amount: gcToEur(MOCK_BALANCE_GC) })}
          </div>
        </div>
      </div>

      <p className={styles.note}>{t('testModeNote')}</p>

      <h2 className={styles.sectionTitle}>{t('topupTitle')}</h2>
      <p className={styles.text}>{t('topupText')}</p>

      <div className={styles.packs}>
        {TOPUP_PACKS.map((pack) => (
          <Link className={styles.pack} key={pack.eur} href={checkoutUrl(pack.eur)}>
            {pack.bonus > 0 ? (
              <span className={styles.packBonus}>
                {t('bonus', { percent: Math.round(pack.bonus * 100) })}
              </span>
            ) : null}
            <span className={styles.packGc}>
              {format.number(pack.gc)} {t('ticker')}
            </span>
            <span className={styles.packEur}>{t('packPrice', { amount: pack.eur })}</span>
            {/* Эффективный курс — то, ради чего лестница и существует:
                без него «+40%» приходится пересчитывать в уме. */}
            <span className={styles.packRate}>{t('packRate', { rate: pack.gc / pack.eur })}</span>
          </Link>
        ))}
      </div>

      <p className={styles.text}>{t('spendHint')}</p>
    </div>
  );
}
