/**
 * Какие разделы словаря уезжают в браузер.
 *
 * `NextIntlClientProvider` без явных сообщений отдаёт клиенту словарь целиком —
 * 27 КБ на русском, из которых половина нужна только персоналу. Посетитель
 * каталога скачивает подписи модераторской очереди и админки, ни разу их
 * не увидев.
 *
 * Разделено на два набора: общий уезжает всем, приватный — только внутри
 * своих маршрутов, где его добавляет вложенный провайдер.
 *
 * Списки сверяются с кодом тестом `client-namespaces.test.ts`: неймспейс,
 * добавленный в клиентский компонент и забытый здесь, уронит тест, а не
 * страницу у посетителя.
 */

/** Нужны в браузере на любой странице. */
export const PUBLIC_CLIENT_NAMESPACES = [
  'ageGate',
  'appearanceType',
  'auth',
  'bodyType',
  'breastSize',
  'breastType',
  'card',
  'cityPicker',
  'comments',
  'contacts',
  'error',
  'eyeColor',
  'favorites',
  'filters',
  'hairColor',
  'languageNames',
  'map',
  'nav',
  'profile',
  'pubicHair',
  // Жалоба на анкету — публичная страница, а не модерация.
  'reports',
  'services',
] as const;

/** Нужны только внутри /account, /admin и /moderation. */
export const PRIVATE_CLIENT_NAMESPACES = [
  'account',
  'admin',
  // Статистика анкет — только у их владельца, в кабинете.
  'analytics',
  // Кошелёк GlowCoin: баланс и пополнение — только в кабинете.
  'billing',
  // Акции: админка и ввод промокода в кабинете.
  'campaigns',
  // Данные агентства и салона — только в кабинете (N-33).
  'company',
  'locations',
  'moderation',
  'settings',
] as const;

type Messages = Record<string, unknown>;

export function pickNamespaces(messages: Messages, names: readonly string[]): Messages {
  const out: Messages = {};
  for (const name of names) {
    if (name in messages) out[name] = messages[name];
  }
  return out;
}
