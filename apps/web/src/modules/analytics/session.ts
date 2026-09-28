import { hostFromUrl, type TrackSession } from '@noova/shared';
import { hasAnalyticsConsent } from '@/layout/cookie-consent';

const STORAGE_KEY = 'noova:sid';

/** Запасной идентификатор, когда `sessionStorage` недоступен (приватное окно,
 *  заблокированные данные сайта): живёт до перезагрузки страницы. */
let memoryId: string | null = null;
let announced = false;

function randomId(): string {
  try {
    return crypto.randomUUID().replaceAll('-', '');
  } catch {
    return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
  }
}

/**
 * Идентификатор сессии браузера. Новый на каждую сессию: `sessionStorage`
 * очищается при закрытии вкладки, поэтому межсессионного следа нет. Ничего
 * не бросает — статистика не должна ломать страницу.
 */
export function getSessionId(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const fresh = randomId();
    sessionStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    memoryId ??= randomId();
    return memoryId;
  }
}

/**
 * Что сообщаем о начале сессии. Реферер — только хост, путь — без строки
 * запроса; метки и идентификатор клика вынимаются из неё отдельно.
 * `consent` — решение баннера (`cookie-consent.ts`) на этот момент: если
 * посетитель ещё не ответил или ответил «нет», идентификатор клика сервер
 * всё равно не сохранит (`ANALYTICS_REQUIRE_CONSENT`), но передать сам
 * идентификатор можно смело — решает именно сервер.
 */
export function buildSessionPayload(
  sessionId: string,
  location: { pathname: string; search: string },
  referrer: string,
): TrackSession {
  const params = new URLSearchParams(location.search);
  const pick = (key: string) => params.get(key) ?? undefined;

  return {
    sessionId,
    landingPath: location.pathname,
    referrerHost: hostFromUrl(referrer) ?? undefined,
    utmSource: pick('utm_source'),
    utmMedium: pick('utm_medium'),
    utmCampaign: pick('utm_campaign'),
    utmContent: pick('utm_content'),
    clickId: pick('click_id'),
    consent: hasAnalyticsConsent(),
  };
}

/** Один раз за сессию: true, если сообщать о ней ещё не пробовали. */
export function shouldAnnounceSession(): boolean {
  try {
    if (sessionStorage.getItem(`${STORAGE_KEY}:sent`)) return false;
    sessionStorage.setItem(`${STORAGE_KEY}:sent`, '1');
    return true;
  } catch {
    if (announced) return false;
    announced = true;
    return true;
  }
}
