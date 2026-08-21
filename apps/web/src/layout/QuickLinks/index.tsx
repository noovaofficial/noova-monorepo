'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { Link, usePathname } from '@/shared/i18n/navigation';
import styles from '../Header.module.css';

type QuickLink = { href: string; label: string; disabled?: boolean };

/**
 * Вторая строка шапки. У гостя и клиента там фильтры каталога, у сотрудников
 * и владельцев анкет каталога нет вовсе — им туда подставляются ссылки
 * на их собственную работу.
 */
export function QuickLinks({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const tf = useTranslations('filters');
  const { user } = useSession();
  const pathname = usePathname();

  const links: QuickLink[] =
    user?.role === 'moderator' || user?.role === 'admin'
      ? [
          { href: '/moderation', label: t('quickQueue') },
          ...(user.role === 'admin' ? [{ href: '/admin', label: t('quickStaff') }] : []),
        ]
      : user?.role === 'advertiser'
        ? [
            { href: '/account/profiles', label: t('quickProfiles') },
            { href: '/account/profiles', label: t('quickAnalytics'), disabled: true },
          ]
        : [];

  // Пустой список означает «показываем фильтры»: гость и клиент работают
  // с каталогом, и подменять им фильтры нечем.
  if (links.length === 0) return <>{children}</>;

  return (
    <div className={styles.quickFilters}>
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.disabled ? pathname : link.href}
          className={`${styles.chip} ${
            !link.disabled && pathname.startsWith(link.href) ? styles.chipSelected : ''
          } ${link.disabled ? styles.chipDisabled : ''}`}
          aria-disabled={link.disabled}
        >
          {link.label}
          {link.disabled ? <span className={styles.chipHint}> · {t('soon')}</span> : null}
        </Link>
      ))}
      <span className="visually-hidden">{tf('top')}</span>
    </div>
  );
}
