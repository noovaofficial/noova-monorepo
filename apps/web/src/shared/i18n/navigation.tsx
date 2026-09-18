'use client';

import { DEFAULT_LOCALE } from '@noova/shared';
import { createNavigation } from 'next-intl/navigation';
import type { ComponentProps } from 'react';
import { useIsAgencySubdomain } from '@/shared/i18n/SubdomainContext';
import { siteHost } from '@/shared/subdomain';
import { routing } from './routing';

const {
  Link: IntlLink,
  redirect,
  usePathname,
  useRouter: useIntlRouter,
  getPathname,
} = createNavigation(routing);

export { getPathname, redirect, usePathname };

/**
 * На поддомене агентства (N-38) относительная ссылка вела бы туда же —
 * `proxy.ts` переписывает там любой путь на страницу компании. Сам
 * поддомен отдаёт только дефолтную локаль, но переключатель языка должен
 * вести на выбранный язык — а он есть только на апексе, у `/company/{slug}`.
 */
function apexHref(href: string, locale: string = DEFAULT_LOCALE): string {
  const path = href.startsWith('/') ? href : `/${href}`;
  return `https://${siteHost()}/${locale}${path}`;
}

type LinkProps = ComponentProps<typeof IntlLink>;

/**
 * Локале-осведомлённая обёртка: сама подставляет текущий языковой префикс —
 * кроме поддомена агентства, где вместо этого уводит ссылку на апекс
 * (см. `apexHref`): у поддомена нет ни каталога, ни кабинета, ни входа,
 * только страница компании.
 */
export function Link({ href, ...rest }: LinkProps) {
  const isAgencySubdomain = useIsAgencySubdomain();
  if (isAgencySubdomain && typeof href === 'string') {
    return <a href={apexHref(href)} {...rest} />;
  }
  return <IntlLink href={href} {...rest} />;
}

export function useRouter() {
  const router = useIntlRouter();
  const isAgencySubdomain = useIsAgencySubdomain();
  if (!isAgencySubdomain) return router;

  return {
    ...router,
    // Из второго аргумента переносится только `locale` — переключатель языка
    // вызывает `router.replace(pathname, { locale: next })`, и на поддомене
    // это должно увести на выбранный язык на апексе, а не всегда на дефолтный.
    // Остальное (`scroll` и т. п.) уже не имеет смысла: это полноценная
    // навигация браузером, а не переход в приложении.
    push: (href: string, options?: { locale?: string }) => {
      window.location.href = apexHref(href, options?.locale);
    },
    replace: (href: string, options?: { locale?: string }) => {
      window.location.href = apexHref(href, options?.locale);
    },
  };
}
