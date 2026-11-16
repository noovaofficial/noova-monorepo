/**
 * Язык сайта для запросов кабинета к API.
 *
 * Названия из справочников (город, район) API отдаёт на языке запроса.
 * Публичные страницы передают язык параметром `?locale=` — их ответы
 * кэшируются по адресу. Запросы кабинета идут из браузера без кэша, и язык
 * едет заголовком: так его не нужно добавлять в каждый адрес.
 *
 * Должен совпадать с `LOCALE_HEADER` в apps/api/src/plugins/locale.ts.
 */
export const LOCALE_HEADER = 'x-noova-locale';

/** Заголовок с текущим языком. На сервере (без `document`) — пусто. */
export function localeHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const lang = document.documentElement.lang;
  return lang ? { [LOCALE_HEADER]: lang } : {};
}
