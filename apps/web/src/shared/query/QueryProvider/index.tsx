'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

/**
 * Клиент создаётся внутри состояния, а не в модуле. Модульная переменная в
 * Next живёт дольше запроса и на сервере оказалась бы общей для разных
 * пользователей — то есть кэш одного посетителя утёк бы другому.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Данные кабинета и модерации меняются от действий самого
            // пользователя, а не сами по себе: короткая свежесть избавляет
            // от лишнего запроса при переходе между экранами.
            staleTime: 30_000,
            // Экраны за логином: перезапрос при возврате на вкладку только
            // мигает интерфейсом. Обновление идёт инвалидацией после мутаций.
            refetchOnWindowFocus: false,
            // 401 и 403 повтором не лечатся — это не сбой сети, а ответ.
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status;
              if (status !== undefined && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
