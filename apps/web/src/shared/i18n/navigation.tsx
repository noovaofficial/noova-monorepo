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
 * `proxy.ts` переписывает там любой путь на страницу компании. Апекс
 * всегда на дефолтной локали: полная версия с языками — только на самом
 * `/company/{slug}`, не на поддомене.
 */
function apexHref(href: string): string {
  const path = href.startsWith('/') ? href : `/${href}`;
  return `https://${siteHost()}/${DEFAULT_LOCALE}${path}`;
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
    // Второй аргумент (`{ locale }`, `{ scroll }`) на апекс не переносится:
    // это уже полноценная навигация браузером, а не переход в приложении.
    push: (href: string, _options?: unknown) => {
      window.location.href = apexHref(href);
    },
    replace: (href: string, _options?: unknown) => {
      window.location.href = apexHref(href);
    },
  };
}
