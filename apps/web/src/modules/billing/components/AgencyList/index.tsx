'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { fetchCompanies } from '@/modules/agencies/api';
import styles from '@/modules/moderation/components/Moderation.module.css';
import { Link } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';

/** Список агентств для админки: найти компанию и открыть её тариф. */
export function AgencyList() {
  const t = useTranslations('billing');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const list = useQuery({
    queryKey: queryKeys.companies(debounced),
    queryFn: () => fetchCompanies(debounced),
  });

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.field} style={{ maxWidth: 360 }}>
          <input
            className={styles.input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('agencySearch')}
          />
        </div>
      </div>

      {list.isError ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{t('loadFailed')}</p>
      ) : null}

      {!list.data ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : list.data.length === 0 ? (
        <p className={styles.empty}>{t('agenciesEmpty')}</p>
      ) : (
        <div className={styles.staffList}>
          {list.data.map((company) => (
            <div className={styles.staffRow} key={company.id}>
              <div className={styles.staffMain}>
                <Link className={styles.staffEmail} href={`/admin/companies/${company.id}`}>
                  {company.name}
                </Link>
                <span className={styles.staffMeta}>
                  {company.slug} ·{' '}
                  {t('agencyProfileCount', {
                    count: company.profileCount,
                    limit: company.effectiveLimit,
                  })}
                  {company.tariffName ? ` · ${company.tariffName}` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
