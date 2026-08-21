import type { ReactNode } from 'react';

/**
 * Сквозной корневой layout: <html>/<body> ставит [locale]/layout.tsx, потому что
 * только там известен язык, а lang="" в выдаче недопустим. Чтение локали здесь
 * (через getLocale) перевело бы всё приложение в динамический рендер и убило ISR.
 * Плата за это — 404 из notFound() отдаёт каркас, который дорисовывается
 * на клиенте; статус 404 и noindex при этом корректны.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
