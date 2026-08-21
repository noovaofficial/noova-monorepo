export const ADULT_COOKIE = 'noova_adult';
export const ADULT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Инлайн-скрипт в <head>: если подтверждение уже есть в куке, помечает документ
 * до первой отрисовки, и CSS скрывает оверлей. Читать куку на сервере нельзя —
 * cookies() в layout переводит всё приложение в динамический рендер и убивает
 * SSG/ISR (см. documentation/implementation-notes.md).
 */
export const AGE_GATE_INIT_SCRIPT = `
(function(){try{
  if(document.cookie.indexOf('${ADULT_COOKIE}=1')>-1){
    document.documentElement.setAttribute('data-adult','yes');
  }
}catch(e){}})();
`.trim();

/** Восстанавливает отметку после перемонтирования layout — см. applyStoredTheme. */
export function applyStoredAdult(): void {
  if (document.cookie.indexOf(`${ADULT_COOKIE}=1`) > -1) {
    document.documentElement.setAttribute('data-adult', 'yes');
  }
}

export function confirmAdult(): void {
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API асинхронный и поддержан не везде
  document.cookie = `${ADULT_COOKIE}=1; path=/; max-age=${ADULT_COOKIE_MAX_AGE}; SameSite=Lax`;
  document.documentElement.setAttribute('data-adult', 'yes');
}
