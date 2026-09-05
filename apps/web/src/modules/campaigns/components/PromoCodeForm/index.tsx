'use client';

import type { RedeemError } from '@noova/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { RedeemRejected, redeemPromo } from '@/modules/campaigns/api';
import { queryKeys } from '@/shared/query-keys';
import styles from './PromoCodeForm.module.css';

/**
 * Ввод промокода в кабинете.
 *
 * Итог показываем словами — что именно начислено и до какого числа теперь
 * оплачено размещение, — а не «успешно»: человек ввёл код ради конкретного
 * подарка и должен увидеть, что получил именно его.
 *
 * Словарь — свой, `promo`, а не `campaigns`: тот приватный и грузится только
 * вложенным провайдером внутри /account, /admin и /moderation. Форма же
 * открывается модалкой из сайдбара (см. AdvertiserLayout), который стоит
 * в дереве выше этого провайдера и его словаря не видит — с `campaigns`
 * компонент вместо переводов рисовал бы сырые ключи.
 */
export function PromoCodeForm() {
  const t = useTranslations('promo');
  const format = useFormatter();
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');

  const redeem = useMutation({
    mutationFn: () => redeemPromo(code.trim().toUpperCase()),
    onSuccess: async () => {
      setCode('');
      // Награда меняет и баланс, и срок размещения — оба видны на этой же
      // странице, и без сброса человек увидел бы прежние числа.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.wallet() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.listing() }),
      ]);
    },
  });

  const reason: RedeemError | null =
    redeem.error instanceof RedeemRejected ? redeem.error.reason : null;
  const reward = redeem.data ?? null;

  return (
    <section className={styles.wrap}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.hint}>{t('hint')}</p>

      <form
        className={styles.row}
        onSubmit={(event) => {
          event.preventDefault();
          redeem.mutate();
        }}
      >
        <input
          className={styles.input}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('title')}
          maxLength={32}
        />
        {/* Пустой код отправлять некуда: сервер ответит отказом, а человек
            решит, что не сработала акция. */}
        <Button type="submit" disabled={redeem.isPending || code.trim().length < 4}>
          {t('submit')}
        </Button>
      </form>

      {reward ? (
        <p className={styles.ok}>
          {t('done', { name: reward.campaignName })}
          {reward.grantedGc > 0 ? ` ${t('gotGc', { gc: reward.grantedGc })}` : ''}
          {reward.listingExpiresAt
            ? ` ${t('gotDays', {
                days: reward.grantedDays,
                date: format.dateTime(new Date(reward.listingExpiresAt), { dateStyle: 'long' }),
              })}`
            : ''}
        </p>
      ) : null}

      {reason ? <p className={styles.err}>{t(`error_${reason}`)}</p> : null}
      {redeem.isError && !reason ? <p className={styles.err}>{t('failed')}</p> : null}
    </section>
  );
}
