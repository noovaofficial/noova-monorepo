/**
 * Cookie с последним посещённым сегментом адреса — городом или кодом страны,
 * как есть, без проверки (N-42). Проверяет и разбирает его `resolveHome`
 * в `city.ts`, у которой есть доступ к справочнику; здесь — только имя,
 * общее для мидлвари (`proxy.ts`, где cookie пишется) и корневой страницы
 * (где она читается).
 */
export const LOCATION_COOKIE = 'noova_location';

/**
 * Страна посетителя по заголовкам запроса (ISO 3166-1, заглавными). Ставится
 * прокси один раз за сессию и читается плашкой «Это ваша локация?» на
 * клиенте — поэтому не httpOnly. Это подсказка, а не решение: плашка
 * сверяет её со справочником активных стран.
 */
export const GEO_COOKIE = 'noova_geo';

/** Посетитель ответил на плашку локации (или выбрал место сам) — больше не спрашиваем. */
export const LOCATION_ACK_COOKIE = 'noova_location_ack';

/** Событие, которым плашка просит шапку открыть панель выбора места. */
export const OPEN_LOCATION_EVENT = 'noova:open-location';

/**
 * Страна из заголовков. Порядок — от надёжного к слабому: геозаголовок
 * CDN/прокси, затем регион в Accept-Language («de-DE» → DE). Язык браузера —
 * лишь намёк: «en-US» ничего не говорит о стране, и плашка в этом случае
 * просто отбросит код, которого нет среди активных стран.
 */
export function countryFromHeaders(get: (name: string) => string | null): string | null {
  for (const name of ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code', 'x-geo-country']) {
    const value = get(name)?.trim().toUpperCase();
    // XX и T1 — служебные значения Cloudflare («неизвестно», Tor).
    if (value && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1') return value;
  }
  const region = get('accept-language')?.match(/^[a-z]{2,3}-([A-Za-z]{2})\b/)?.[1];
  return region ? region.toUpperCase() : null;
}
