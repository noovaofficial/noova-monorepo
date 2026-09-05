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

/**
 * Вызывается, когда сервер подтвердил, что сессии нет. Раньше стирались
 * только data-атрибуты, а сами куки `noova_signed_in`/`noova_role` оставались
 * в браузере: `SessionProvider` не может их очистить сам, `httpOnly`-кука
 * сессии тут ни при чём — она угасает независимо, и эти две повисают.
 * Из-за этого `proxy.ts` на каждой следующей загрузке снова уводил гостя по
 * протухшей куке роли с витрины на `/moderation` или `/account/profiles`, а
 * та страница — сразу на `/login`: анонимный вход на главную превращался в
 * постоянный редирект туда и обратно. Стираем куки здесь же, при первом
 * обнаружении расхождения, чтобы дальше `proxy.ts` видел то же, что и сервер.
 */
export function clearSessionHint(): void {
  document.documentElement.removeAttribute('data-signed-in');
  document.documentElement.removeAttribute('data-role');
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API асинхронный и поддержан не везде
  document.cookie = `${SIGNED_IN_COOKIE}=; path=/; max-age=0`;
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API асинхронный и поддержан не везде
  document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0`;
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
