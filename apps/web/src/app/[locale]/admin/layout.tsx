import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import {
  PRIVATE_CLIENT_NAMESPACES,
  PUBLIC_CLIENT_NAMESPACES,
  pickNamespaces,
} from '@/shared/i18n/client-namespaces';

/**
 * Приватные разделы словаря добавляются здесь, а не в корневом макете:
 * подписи кабинета, админки и модерации не нужны посетителю каталога и
 * составляют больше половины веса словаря.
 *
 * Провайдер вложенный и заменяет набор целиком, поэтому включает и общий:
 * шапка с подвалом рендерятся выше и берут свой, а компоненты внутри —
 * этот.
 */
export default async function PrivateSectionLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider
      messages={pickNamespaces(messages, [
        ...PUBLIC_CLIENT_NAMESPACES,
        ...PRIVATE_CLIENT_NAMESPACES,
      ])}
    >
      {children}
    </NextIntlClientProvider>
  );
}
