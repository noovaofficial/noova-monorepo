'use client';

import { createContext, type ReactNode, useContext } from 'react';

const SubdomainContext = createContext<string | null>(null);

/**
 * Значение приходит из layout (сервер, читает заголовок `Host`) и совпадает
 * при первом клиентском рендере — иначе была бы рассинхронизация гидратации.
 */
export function SubdomainProvider({
  agencySlug,
  children,
}: {
  agencySlug: string | null;
  children: ReactNode;
}) {
  return <SubdomainContext.Provider value={agencySlug}>{children}</SubdomainContext.Provider>;
}

/**
 * Слуг агентства, если сайт открыт через его поддомен (N-38), иначе `null`.
 *
 * Нужен, а не просто признак «мы на поддомене»: видимый браузером путь там
 * всегда `/` (`proxy.ts` переписывает его на `/company/{slug}` на сервере,
 * адресную строку это не меняет), и без слуга «остаться на этой же
 * странице» (например, при смене языка) собрать было бы не из чего.
 */
export function useAgencySlug(): string | null {
  return useContext(SubdomainContext);
}

/**
 * На поддомене агентства внутренние ссылки должны вести на апекс —
 * `proxy.ts` переписывает там любой путь на страницу компании, и обычная
 * относительная ссылка (вход, регистрация, чужая анкета) вела бы саму на себя.
 */
export function useIsAgencySubdomain(): boolean {
  return useAgencySlug() !== null;
}
