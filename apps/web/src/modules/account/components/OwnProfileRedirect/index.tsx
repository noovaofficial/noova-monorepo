'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { fetchOwnProfiles } from '@/modules/account/api';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from '../Account.module.css';

/**
 * «Мой профиль» у индивидуалки: анкета у неё одна, поэтому вместо списка
 * ведём сразу в редактор. Анкеты ещё нет — уходим на страницу со списком:
 * там форма создания.
 */
export function OwnProfileRedirect() {
  const t = useTranslations('account');
  const router = useRouter();
  const { status } = useSession();

  const list = useQuery({
    queryKey: queryKeys.ownProfiles(),
    queryFn: fetchOwnProfiles,
    enabled: status === 'authenticated',
  });

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
      return;
    }
    if (!list.data) return;
    const first = list.data[0];
    router.replace(first ? `/account/profiles/${first.id}` : '/account/profiles');
  }, [status, list.data, router]);

  return <p className={styles.empty}>{list.isError ? t('loadFailed') : t('loading')}</p>;
}
