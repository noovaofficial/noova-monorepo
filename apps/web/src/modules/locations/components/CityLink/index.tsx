'use client';

import type { ReactNode } from 'react';
import { Link, usePathname } from '@/shared/i18n/navigation';

/**
 * Ссылка на витринную страницу, несущая текущий город.
 *
 * Язык подставляет обёртка next-intl, город — второе измерение, и без этого
 * компонента его пришлось бы передавать руками в каждое место (N-32).
 *
 * Города в адресе нет — отдаём путь без префикса: он ведёт на заглушку
 * `/{locale}/catalog/...`, которая постоянным редиректом уводит в первый
 * активный город. Один лишний переход лучше, чем битая ссылка.
 */
export function CityLink({
  href,
  citySlugs,
  className,
  children,
}: {
  /** Путь внутри города, начиная со слеша: `/catalog/escort`. */
  href: string;
  citySlugs: string[];
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [, first = ''] = pathname.split('/');
  const city = citySlugs.includes(first) ? first : null;

  return (
    <Link className={className} href={city ? `/${city}${href}` : href}>
      {children}
    </Link>
  );
}
