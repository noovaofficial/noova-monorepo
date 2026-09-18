'use client';

import type { ReactNode } from 'react';
import { Link, usePathname } from '@/shared/i18n/navigation';

/**
 * Ссылка на витринную страницу, несущая текущую локацию — город или страну
 * целиком (N-43).
 *
 * Язык подставляет обёртка next-intl, локация — второе измерение, и без
 * этого компонента её пришлось бы передавать руками в каждое место (N-32).
 *
 * Ни город, ни код страны не опознаны — отдаём путь без префикса: он ведёт
 * на заглушку `/{locale}/catalog/...`, которая постоянным редиректом уводит
 * на страну по умолчанию. Один лишний переход лучше, чем битая ссылка —
 * но это крайний случай (анкета, кабинет и т.п.), а не главная другой
 * страны: там локация уже опознана и в префикс попадёт именно она.
 */
export function CityLink({
  href,
  citySlugs,
  countryCodes,
  className,
  children,
}: {
  /** Путь внутри локации, начиная со слеша: `/catalog/escort`. */
  href: string;
  citySlugs: string[];
  /** В нижнем регистре — так же, как код страны лежит в адресе. */
  countryCodes: string[];
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [, first = ''] = pathname.split('/');
  const location = citySlugs.includes(first)
    ? first
    : countryCodes.includes(first.toLowerCase())
      ? first
      : null;

  return (
    <Link className={className} href={location ? `/${location}${href}` : href}>
      {children}
    </Link>
  );
}
