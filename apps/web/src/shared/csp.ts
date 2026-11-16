/**
 * Content-Security-Policy сайта. Заголовок ставит `proxy.ts` на каждый запрос
 * страницы: в нём одноразовая метка (nonce), поэтому собрать его один раз в
 * `next.config.ts` нельзя.
 *
 * Режим задаёт переменная окружения `CSP_MODE`:
 *  - `report` (по умолчанию) — браузер ничего не блокирует, только шлёт отчёты
 *    о нарушениях в API (`/api/v1/csp-report`, пишутся в лог);
 *  - `enforce` — блокирует;
 *  - `off` — заголовка нет.
 * Переключать на `enforce` — после недели чистых отчётов.
 */
export type CspMode = 'off' | 'report' | 'enforce';

export function cspMode(value: string | undefined): CspMode {
  return value === 'off' || value === 'enforce' ? value : 'report';
}

export const CSP_HEADER: Record<Exclude<CspMode, 'off'>, string> = {
  report: 'Content-Security-Policy-Report-Only',
  enforce: 'Content-Security-Policy',
};

/** Источник (`https://host:port`) из адреса; мусор в переменной — пусто. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type CspOptions = {
  nonce: string;
  mode: Exclude<CspMode, 'off'>;
  isDev: boolean;
  /** Публичный адрес API: на поддомене агентства он другого происхождения. */
  apiUrl?: string;
  /** Адрес, с которого раздаются одобренные фото и видео. */
  mediaUrl?: string;
};

export function buildCsp({ nonce, mode, isDev, apiUrl, mediaUrl }: CspOptions): string {
  const api = originOf(apiUrl);
  const media = originOf(mediaUrl);
  const own = ["'self'", ...new Set([api, media].filter((value) => value !== null))];

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Скрипты — только с меткой этого ответа. `strict-dynamic` передаёт
    // доверие тем, что они подгружают сами (чанки Next); `'self'` остаётся
    // для старых браузеров, которые `strict-dynamic` не понимают.
    // `unsafe-eval` — только в разработке: им пользуется React для отладки.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Инлайновые стили разрешены: вёрстка задаёт их атрибутом `style`
    // (градиенты-заглушки, размеры), метку на атрибут не повесить. Через
    // стиль чужой код не выполнить — цена послабления невелика.
    'style-src': ["'self'", "'unsafe-inline'"],
    // `data:` — размытые превью фото и значки карты, `blob:` — предпросмотр
    // загружаемого файла. Неодобренные фото владельцу и модератору отдаёт API.
    'img-src': [...own, 'data:', 'blob:'],
    'media-src': [...own, 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [...own, ...(isDev ? ['ws:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    // В режиме отчёта браузер эту директиву не принимает и ругается в консоль.
    ...(mode === 'enforce' && !isDev ? { 'upgrade-insecure-requests': [] } : {}),
    ...(api ? { 'report-uri': [`${api}/api/v1/csp-report`] } : {}),
  };

  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}

/** Заголовок запроса, которым `proxy.ts` передаёт метку в layout. */
export const NONCE_HEADER = 'x-nonce';
