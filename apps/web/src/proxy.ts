import { isLocale, RESERVED_CITY_SLUGS } from '@noova/shared';
import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './shared/i18n/routing';

const handleI18n = createMiddleware(routing);

/**
 * Куда отправлять вошедшего вместо каталога. Каталог — витрина для гостей;
 * сотрудникам и владельцам анкет он на входе не нужен, им нужна работа.
 */
const HOME_BY_ROLE: Record<string, string> = {
  moderator: '/moderation',
  admin: '/moderation',
  advertiser: '/account/profiles',
};

/**
 * Что закрыто для какой роли. Клиента и гостя не трогаем — витрина для них.
 *
 * Рекламодателю страницы анкет оставлены: без них он не может посмотреть
 * собственную анкету глазами посетителя, а именно для этого в кабинете есть
 * кнопка «Открыть». Просматривать чужие через каталог он всё равно не может —
 * каталога у него нет.
 *
 * Модератору `/profile` закрыт: у него есть свой просмотр `/moderation/profiles`,
 * который показывает и неопубликованное.
 */
const BLOCKED_BY_ROLE: Record<string, string[]> = {
  moderator: ['', '/catalog', '/profile'],
  admin: ['', '/catalog', '/profile'],
  advertiser: ['', '/catalog'],
};

/**
 * Сегменты после языка, которые задают собственный маршрут. Всё остальное на
 * этом месте — слуг города: `/ru/berlin/catalog/escort` (N-32).
 *
 * Список тот же, что `RESERVED_CITY_SLUGS`, и по той же причине: город и
 * статические маршруты делят одно место в адресе. Сверяется тестом.
 */
const ROUTE_SEGMENTS = new Set<string>(RESERVED_CITY_SLUGS);

/**
 * Путь без языка и без города — в терминах, которыми описан доступ по ролям.
 * Витрина у каждого города своя, но закрыта она для сотрудника целиком, и
 * перечислять города в правилах доступа значило бы править их при каждом
 * новом городе.
 */
function pathWithoutCity(rest: string): string {
  const [, first = '', ...tail] = rest.split('/');
  if (first === '' || ROUTE_SEGMENTS.has(first)) return rest;
  return tail.length > 0 ? `/${tail.join('/')}` : '';
}

function localeOf(pathname: string): string {
  const first = pathname.split('/')[1] ?? '';
  return isLocale(first) ? first : routing.defaultLocale;
}

function pathWithoutLocale(pathname: string): string {
  const first = pathname.split('/')[1] ?? '';
  return isLocale(first) ? pathname.slice(first.length + 1) || '' : pathname;
}

export default function proxy(request: NextRequest) {
  const response = handleI18n(request);

  // Редирект строится по куке с ролью. Это подсказка интерфейсу, а не защита:
  // куку легко подделать, но она влияет только на то, какую страницу открыть.
  // Доступ к данным везде проверяется на сервере по сессии.
  const role = request.cookies.get('noova_role')?.value;
  const target = role ? HOME_BY_ROLE[role] : undefined;
  const blocked = role ? BLOCKED_BY_ROLE[role] : undefined;
  if (!target || !blocked) return response;

  const { pathname } = request.nextUrl;
  const rest = pathWithoutCity(pathWithoutLocale(pathname));
  const isBlocked = blocked.some(
    (prefix) => rest === prefix || (prefix !== '' && rest.startsWith(`${prefix}/`)),
  );
  if (!isBlocked) return response;

  const url = request.nextUrl.clone();
  url.pathname = `/${localeOf(pathname)}${target}`;
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Пропускаем статику, служебные роуты Next и файлы для поисковиков —
  // языковой префикс им не нужен и он ломает их обнаружение.
  matcher: ['/((?!api|_next|_vercel|robots.txt|sitemap.xml|favicon.ico|.*\\..*).*)'],
};
