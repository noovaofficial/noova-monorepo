/**
 * Решение посетителя о согласии на аналитику (TDDDG §25). Простое да/нет,
 * не категории: единственное, что реально зависит от согласия сейчас —
 * идентификатор клика рекламной сети (`network_click_id`,
 * `ANALYTICS_REQUIRE_CONSENT` на сервере), см. `modules/analytics/session.ts`.
 * Заводить категории («аналитика», «реклама») под функциональность,
 * которой пока нет, — искусственный выбор, который никак не помогает
 * посетителю.
 */

export const CONSENT_COOKIE = 'noova_consent';
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ConsentDecision = 'yes' | 'no';

function isDecision(value: string | null): value is ConsentDecision {
  return value === 'yes' || value === 'no';
}

/**
 * Инлайн-скрипт в <head>: если решение уже есть в куке, помечает документ до
 * первой отрисовки — так же, как тема и возрастной гейт. Баннер прячется
 * CSS по этому атрибуту; без скрипта он на мгновение мигал бы уже
 * решившим посетителям при каждой загрузке.
 */
export const CONSENT_INIT_SCRIPT = `
(function(){try{
  var m=document.cookie.match(/(?:^|; )${CONSENT_COOKIE}=([^;]*)/);
  var v=m?decodeURIComponent(m[1]):null;
  if(v==='yes'||v==='no'){document.documentElement.setAttribute('data-consent',v);}
}catch(e){}})();
`.trim();

/** Восстанавливает атрибут после перемонтирования layout — см. applyStoredTheme. */
export function applyStoredConsent(): void {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`));
    const value = match?.[1] ? decodeURIComponent(match[1]) : null;
    if (isDecision(value)) document.documentElement.setAttribute('data-consent', value);
  } catch {
    // Без куки решать нечего — баннер просто остаётся видимым.
  }
}

/** Сохраняет решение и на этой же странице, без перезагрузки. */
export function setConsent(decision: ConsentDecision): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API асинхронный и поддержан не везде
    document.cookie = `${CONSENT_COOKIE}=${decision}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    // Сохранить не удалось — баннер останется видимым при следующей загрузке,
    // это безопаснее, чем скрыть его и потерять решение бесследно.
  }
  try {
    document.documentElement.setAttribute('data-consent', decision);
  } catch {
    // См. выше.
  }
}

/** Стирает решение — «изменить настройки cookie» на странице политики
 *  показывает баннер заново, не трогая остальные куки посетителя. */
export function resetConsent(): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API асинхронный и поддержан не везде
    document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
  } catch {
    // См. setConsent — то же решение.
  }
  try {
    document.documentElement.removeAttribute('data-consent');
  } catch {
    // См. выше.
  }
}

/**
 * Согласился ли посетитель на сохранение идентификатора клика рекламной
 * сети. Читается один раз, в момент отправки маяка начала сессии
 * (`modules/analytics/session.ts`) — раньше решать было нечему, баннера не
 * было. Отсутствие решения и явное «нет» здесь неотличимы: сервер и так по
 * умолчанию требует явного «да» (`ANALYTICS_REQUIRE_CONSENT`).
 */
export function hasAnalyticsConsent(): boolean {
  try {
    return document.cookie.includes(`${CONSENT_COOKIE}=yes`);
  } catch {
    return false;
  }
}
