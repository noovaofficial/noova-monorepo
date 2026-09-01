'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { isStaffRole, sectionsFor } from '@/modules/moderation/staff-sections';
import { Link, usePathname } from '@/shared/i18n/navigation';
import styles from '../Header.module.css';

type QuickLink = { href: string; label: string; disabled?: boolean };

/**
 * Вторая строка шапки. У гостя и клиента там фильтры каталога, у сотрудников
 * и владельцев анкет каталога нет вовсе — им туда подставляются ссылки
 * на их собственную работу.
 *
 * Подсветка по точному совпадению, а не по префиксу: `/moderation` иначе
 * горел бы и на `/moderation/users`, и выбранными оказались бы два раздела.
 */
export function QuickLinks({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const tf = useTranslations('filters');
  // Подписи разделов персонала — из того же словаря, что у меню учётной записи.
  const ta = useTranslations('auth');
  const { user } = useSession();
  const pathname = usePathname();

  const links: QuickLink[] = isStaffRole(user?.role)
    ? sectionsFor(user?.role).map((section) => ({
        href: section.href,
        label: ta(section.key),
      }))
    : user?.role === 'advertiser'
      ? [
          { href: '/account/profiles', label: t('quickProfiles') },
          // Компания есть только у агентства и салона: индивидуалка размещает
          // анкету от своего имени, посредника у неё нет.
          // Только агентству: у салона компании нет — он сам анкета (N-34).
          ...(user.advertiserKind === 'agency'
            ? [{ href: '/account/company', label: t('quickCompany') }]
            : []),
          // Кошелёк — всем трём типам размещения: платят одинаково, разница
          // только в цене срока.
          { href: '/account/glowcoin', label: t('quickGlowcoin') },
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
            !link.disabled && pathname === link.href ? styles.chipSelected : ''
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
