'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { MenuIcon } from '@/layout/HeaderActions/icons';
import { SidebarLayout } from '@/layout/SidebarLayout';
import styles from '@/layout/SidebarLayout/SidebarLayout.module.css';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { fetchQueueCount } from '@/modules/moderation/api';
import { type StaffSectionGroup, sectionsFor } from '@/modules/moderation/staff-sections';
import { Link, usePathname } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';

const GROUP_ORDER: StaffSectionGroup[] = ['moderation', 'people', 'reference', 'mail'];
const GROUP_LABEL_KEY: Record<StaffSectionGroup, string> = {
  moderation: 'staffGroupModeration',
  people: 'staffGroupPeople',
  reference: 'staffGroupReference',
  mail: 'staffGroupMail',
};

/** Разделы персонала — по группам, с счётчиком очереди на «Модерации». */
export function StaffLayout({ children }: { children: ReactNode }) {
  const ta = useTranslations('auth');
  const { user } = useSession();
  const pathname = usePathname();

  // Общий ключ с шапкой учётной записи: после решения в очереди счётчик
  // обновляется инвалидацией, без своего перезапроса.
  const { data: queue } = useQuery({ queryKey: queryKeys.queueCount(), queryFn: fetchQueueCount });
  const queueCount = queue?.total ?? 0;

  const sections = sectionsFor(user?.role);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: sections.filter((section) => section.group === group),
  })).filter((entry) => entry.items.length > 0);

  const nav = (
    <nav className={styles.nav} aria-label={ta('accountMenu')}>
      {groups.map(({ group, items }) => (
        <div key={group}>
          <span className={styles.groupLabel}>{ta(GROUP_LABEL_KEY[group])}</span>
          {items.map((section) =>
            section.external ? (
              // Обычная ссылка, а не Link: тот дописал бы к чужому адресу
              // префикс языка. В новой вкладке — чтобы не терять место в
              // админке, пока разбираешь почту.
              <a
                key={section.key}
                href={section.href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.item}
              >
                <MenuIcon name={section.key} className={styles.itemIcon} />
                {ta(section.key)}
                <MenuIcon name="external" className={styles.itemExternal} />
              </a>
            ) : (
              <Link
                key={section.key}
                href={section.href}
                className={`${styles.item} ${pathname === section.href ? styles.itemActive : ''}`}
              >
                <MenuIcon name={section.key} className={styles.itemIcon} />
                {ta(section.key)}
                {section.key === 'moderation' && queueCount > 0 ? (
                  <span className={styles.badge}>{queueCount}</span>
                ) : null}
              </Link>
            ),
          )}
        </div>
      ))}
    </nav>
  );

  return <SidebarLayout nav={nav}>{children}</SidebarLayout>;
}
