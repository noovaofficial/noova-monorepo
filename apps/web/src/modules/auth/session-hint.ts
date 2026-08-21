export const SIGNED_IN_COOKIE = 'noova_signed_in';
export const ROLE_COOKIE = 'noova_role';

/**
 * Инлайн-скрипт в <head>: помечает документ признаком входа до первой отрисовки.
 * Сама сессия лежит в httpOnly-куке и здесь недоступна — это только подсказка
 * для разметки. Читать сессию на сервере нельзя: cookies() в layout перевёл бы
 * всё приложение в динамический рендер и убил SSG (см. implementation-notes).
 */
export const SESSION_HINT_SCRIPT = `
(function(){try{
  if(document.cookie.indexOf('${SIGNED_IN_COOKIE}=1')>-1){
    document.documentElement.setAttribute('data-signed-in','yes');
  }
  var m=document.cookie.match(/(?:^|; )${ROLE_COOKIE}=([^;]*)/);
  if(m){document.documentElement.setAttribute('data-role',decodeURIComponent(m[1]));}
}catch(e){}})();
`.trim();

export function clearSessionHint(): void {
  document.documentElement.removeAttribute('data-signed-in');
  document.documentElement.removeAttribute('data-role');
}

/** Возвращает атрибуты после перемонтирования layout — см. applyStoredTheme. */
export function applyStoredSessionHint(): void {
  const html = document.documentElement;
  if (document.cookie.indexOf(`${SIGNED_IN_COOKIE}=1`) > -1) {
    html.setAttribute('data-signed-in', 'yes');
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${ROLE_COOKIE}=([^;]*)`));
  if (match?.[1]) html.setAttribute('data-role', decodeURIComponent(match[1]));
}

export function setSessionHint(): void {
  document.documentElement.setAttribute('data-signed-in', 'yes');
}
