'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { Logo } from '@/design-system/components/Logo';
import { HeaderActions } from '@/layout/HeaderActions';
import { MenuIcon } from '@/layout/HeaderActions/icons';
import { LocaleSwitcher } from '@/layout/LocaleSwitcher';
import { ThemeToggle } from '@/layout/ThemeToggle';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { Link, usePathname, useRouter } from '@/shared/i18n/navigation';
import styles from './SidebarLayout.module.css';

/**
 * Каркас рабочего места: фиксированный сайдбар на всю высоту вместо
 * витринной шапки — общий для персонала и рекламодателей (см. StaffLayout,
 * AdvertiserLayout), у обоих одно устройство страницы и различается только
 * состав `nav`. Гостю и клиенту это не нужно: у них по-прежнему витрина
 * с городом и фильтрами каталога (см. AppShell).
 *
 * На узком экране сайдбар превращается в выезжающую панель — ему негде
 * стоять рядом с контентом.
 */
export function SidebarLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const t = useTranslations('nav');
  const ta = useTranslations('auth');
  const { signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Переход на другую страницу — сигнал закрыть панель: иначе на телефоне
  // она осталась бы открытой поверх уже другого раздела. `pathname` в
  // зависимостях специально не используется в теле — он здесь ради самого
  // события смены маршрута, а не своего значения.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname — триггер эффекта, а не его аргумент
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Пока панель открыта поверх страницы, сама страница не должна прокручиваться:
  // иначе жест скролла по панели двигает ещё и то, что скрыто под ней.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  async function onSignOut() {
    await signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        {t('skipToContent')}
      </a>

      {open ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label={ta('closeMenu')}
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
        <Link href="/" className={styles.brand}>
          <Logo size={24} />
        </Link>

        {nav}

        {/* Настройки и выход — не разделы работы, а сама учётная запись:
            отдельно от навигации выше, прижаты к низу панели. */}
        <div className={styles.sidebarFoot}>
          <Link
            href="/account/settings"
            className={`${styles.item} ${pathname === '/account/settings' ? styles.itemActive : ''}`}
          >
            <MenuIcon name="settings" className={styles.itemIcon} />
            {ta('settings')}
          </Link>
          <button
            type="button"
            className={`${styles.item} ${styles.itemDanger}`}
            onClick={onSignOut}
          >
            <MenuIcon name="logout" className={styles.itemIcon} />
            {ta('logout')}
          </button>
        </div>
      </aside>

      <div className={styles.contentArea}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.menuBtn}
            onClick={() => setOpen(true)}
            aria-label={ta('openMenu')}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3 5.5h14M3 10h14M3 14.5h14" />
            </svg>
          </button>

          <div className={styles.topbarEnd}>
            <LocaleSwitcher />
            <ThemeToggle />
            <HeaderActions />
          </div>
        </header>

        <main id="main" className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
