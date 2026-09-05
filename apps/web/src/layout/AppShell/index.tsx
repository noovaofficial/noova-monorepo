'use client';

import type { ReactNode } from 'react';
import { AdvertiserLayout } from '@/layout/AdvertiserLayout';
import { StaffLayout } from '@/layout/StaffLayout';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { isStaffRole } from '@/modules/moderation/staff-sections';

/**
 * Витрина и рабочее место — разное устройство страницы для разных ролей, но
 * роль известна только клиенту (см. session-hint.ts: сессию нельзя прочитать
 * на сервере, не выключив статику всего сайта). Поэтому решение здесь, а
 * `header`/`footer` приходят уже отрисованными из серверного layout —
 * `Header` асинхронный и сам ходит за данными, а клиентский компонент не
 * может отрисовать серверный напрямую, только принять его как children.
 *
 * Гость и клиент остаются на витрине: город, каталог, фильтры — это их
 * сценарий. Персонал и рекламодатель размещают анкеты или модерируют, а не
 * ищут анкеты в каталоге, поэтому оба получают один и тот же сайдбар
 * (см. SidebarLayout), только с разным составом разделов.
 *
 * Для сайдбара `header`/`footer` попадают в дерево, но не в возврат: сама
 * отрисовка на сервере уже произошла, лишний неиспользованный проход по
 * справочнику городов и услуг — небольшая цена за то, что серверный layout
 * остаётся один на все устройства страницы.
 */
export function AppShell({
  header,
  footer,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { user } = useSession();

  if (isStaffRole(user?.role)) {
    return <StaffLayout>{children}</StaffLayout>;
  }

  if (user?.role === 'advertiser') {
    return <AdvertiserLayout>{children}</AdvertiserLayout>;
  }

  return (
    <>
      {header}
      <main id="main" className="container">
        {children}
      </main>
      {footer}
    </>
  );
}
