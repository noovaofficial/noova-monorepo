'use client';

import { createContext, type ReactNode, useContext } from 'react';

const SubdomainContext = createContext(false);

/**
 * Значение приходит из layout (сервер, читает заголовок `Host`) и совпадает
 * при первом клиентском рендере — иначе была бы рассинхронизация гидратации.
 */
export function SubdomainProvider({
  isAgencySubdomain,
  children,
}: {
  isAgencySubdomain: boolean;
  children: ReactNode;
}) {
  return (
    <SubdomainContext.Provider value={isAgencySubdomain}>{children}</SubdomainContext.Provider>
  );
}

/**
 * На поддомене агентства (N-38) внутренние ссылки должны вести на апекс —
 * `proxy.ts` переписывает там любой путь на страницу компании, и обычная
 * относительная ссылка (вход, регистрация, чужая анкета) вела бы саму на себя.
 */
export function useIsAgencySubdomain(): boolean {
  return useContext(SubdomainContext);
}
