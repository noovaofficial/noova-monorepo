import { isLocale, LOCALES } from '@noova/shared';
import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from '@/design-system/theme';
import { AgeGate } from '@/layout/AgeGate';
import { AGE_GATE_INIT_SCRIPT } from '@/layout/age-gate';
import { Footer } from '@/layout/Footer';
import { Header } from '@/layout/Header';
import { SessionProvider } from '@/modules/auth/components/SessionProvider';
import { SESSION_HINT_SCRIPT } from '@/modules/auth/session-hint';
import { FavoritesProvider } from '@/modules/favorites/components/FavoritesProvider';
import { routing } from '@/shared/i18n/routing';
import { QueryProvider } from '@/shared/query/QueryProvider';
import '@/design-system/globals.css';

// Self-hosted через next/font: без запроса к Google Fonts на каждой загрузке
// (быстрее и не течёт IP посетителя третьей стороне — важно для 18+ каталога).
const sora = Sora({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sora',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    // Без metadataBase canonical и hreflang выводятся относительными путями,
    // а поисковики требуют абсолютные URL.
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: t('siteName'), template: `%s · ${t('siteName')}` },
    description: t('homeDescription'),
    // Каталог 18+: помечаем контент для семейных фильтров браузеров и поисковиков.
    other: { rating: 'adult', 'RTA-5042-1996-1400-1577-RTA': 'RTA-5042-1996-1400-1577-RTA' },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Неизвестный префикс сюда не доходит — его разбирает proxy. Откат на язык
  // по умолчанию вместо notFound(): повторный notFound() из layout ломает
  // рендер 404-границы.
  const { locale: rawLocale } = await params;
  const locale =
    hasLocale(routing.locales, rawLocale) && isLocale(rawLocale)
      ? rawLocale
      : routing.defaultLocale;

  // Включает статическую генерацию для всех страниц под этим layout.
  setRequestLocale(locale);

  return (
    // data-theme и data-adult намеренно НЕ задаются здесь. Смена языка
    // перемонтирует этот layout, и React перезаписал бы атрибут значением
    // по умолчанию, затирая выбор пользователя. Ими владеет инлайн-скрипт
    // ниже, а тёмная тема остаётся дефолтом через CSS.
    <html lang={locale} className={`${sora.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Тема применяется до первой отрисовки, иначе при статике страница мигает. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: константный инлайн-скрипт темы, пользовательских данных нет
          dangerouslySetInnerHTML={{
            __html: `${THEME_INIT_SCRIPT}${AGE_GATE_INIT_SCRIPT}${SESSION_HINT_SCRIPT}`,
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider>
          {/* Query выше сессии: провайдер сессии сам ходит в API. Публичные
              страницы это не затрагивает — они грузятся на сервере. */}
          <QueryProvider>
            <SessionProvider>
              {/* Внутри SessionProvider: избранное грузится только когда роль
                уже известна, иначе гость получал бы 401 на каждой странице. */}
              <FavoritesProvider>
                <Header />
                <main id="main" className="container">
                  {children}
                </main>
                <Footer />
                <AgeGate />
              </FavoritesProvider>
            </SessionProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
