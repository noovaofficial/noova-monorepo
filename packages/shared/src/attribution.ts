import { z } from 'zod';

/**
 * Откуда пришёл посетитель. Пять значений, одно на сессию.
 *
 * Порядок проверок в `classifySource` — порядок приоритета: платная сеть
 * важнее UTM (реклама в сети почти всегда несёт и то и другое, а деньги
 * считаем по сети), UTM важнее реферера (метка — это явное намерение
 * рекламодателя, реферер — догадка браузера).
 */
export const SOURCE_KINDS = ['network', 'utm', 'organic', 'referral', 'direct'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Платные сети, с которыми работаем. Распознаём по `utm_source`: это то, что
 * мы сами требуем ставить в ссылках кампаний (сеть = значение `utm_source`). Имя параметра с идентификатором клика у каждой сети своё и
 * здесь намеренно не угадывается — оно появится вместе с адаптером сети.
 */
export const KNOWN_NETWORKS = ['exoclick', 'eroadvertising'] as const;
export type KnownNetwork = (typeof KNOWN_NETWORKS)[number];

/** Поисковики: сравниваем по «ядру» домена, чтобы google.de и www.google.com
 *  не приходилось перечислять по одному. */
const SEARCH_ENGINE_CORES = [
  'google',
  'bing',
  'duckduckgo',
  'yahoo',
  'yandex',
  'ecosia',
  'startpage',
  'qwant',
  'brave',
  'baidu',
  'seznam',
  'ask',
] as const;

/** Длина, дольше которой метка — почти наверняка мусор или попытка забить поле. */
const UTM_MAX_LENGTH = 100;

export type SourceInput = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** Только хост, без схемы и пути. */
  referrerHost?: string | null;
  /** Наши собственные хосты: заход со своей же страницы — не реферал. */
  ownHosts?: readonly string[];
};

export type SourceClassification = {
  source: SourceKind;
  /** Заполнено только у `network`. */
  network: KnownNetwork | null;
};

/** Метка в нижнем регистре, обрезанная и без пустой строки: «Test» и «test»
 *  в отчёте — один источник. */
export function cleanUtm(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().slice(0, UTM_MAX_LENGTH);
  return trimmed ? trimmed : null;
}

/** Хост без `www.` и в нижнем регистре; для пустого или нечитаемого — null. */
export function normalizeHost(value: string | null | undefined): string | null {
  const host = value
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, '');
  return host && /^[a-z0-9.-]+$/.test(host) ? host.slice(0, 253) : null;
}

/**
 * Хост из полного URL (`document.referrer`); нечитаемое даёт null.
 *
 * Без глобального `URL`: этот пакет собирается и типизируется отдельно от
 * `apps/web` (DOM) и `apps/api` (Node) — `tsconfig.json` здесь не знает ни
 * про тот, ни про другой лексикон глобалов, и `new URL(...)` не пройдёт
 * `tsc --noEmit` в изолированной сборке (`pnpm -r typecheck`), хотя молча
 * проходил в обоих приложениях, у которых глобал есть. Для хоста реферера
 * полноценный парсер не нужен — только то, что лежит между `//` и первым
 * `/`, `?`, `#` или `@`.
 */
export function hostFromUrl(url: string | null | undefined): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url?.trim() ?? '');
  const authority = match?.[1];
  if (!authority) return null;
  // Отбрасываем userinfo (`user:pass@`) и порт — `normalizeHost` дальше
  // всё равно отвергнет то, что не похоже на голый хост (в т. ч. IPv6
  // в скобках: `[::1]` не проходит её regex, и это осознанно — реферер
  // с IPv6-литералом статистике ничем не полезен).
  const host = authority.split('@').pop()?.split(':')[0];
  return normalizeHost(host);
}

export function isSearchEngineHost(host: string): boolean {
  // Ядро — любой сегмент домена, кроме зоны: «google.co.uk» → google,
  // «search.yahoo.com» → yahoo.
  return host.split('.').some((part) => (SEARCH_ENGINE_CORES as readonly string[]).includes(part));
}

function isKnownNetwork(value: string | null): value is KnownNetwork {
  return value !== null && (KNOWN_NETWORKS as readonly string[]).includes(value);
}

/**
 * Единственное место, где посещению присваивается источник. Кабинет,
 * дашборд и роллапы используют её, а не собственные проверки: иначе «органика»
 * в двух отчётах считалась бы по-разному.
 */
export function classifySource(input: SourceInput): SourceClassification {
  const utmSource = cleanUtm(input.utmSource);
  if (isKnownNetwork(utmSource)) return { source: 'network', network: utmSource };
  if (utmSource || cleanUtm(input.utmMedium) || cleanUtm(input.utmCampaign)) {
    return { source: 'utm', network: null };
  }

  const host = normalizeHost(input.referrerHost);
  const own = (input.ownHosts ?? []).map(normalizeHost);
  if (host && !own.some((h) => h !== null && (host === h || host.endsWith(`.${h}`)))) {
    return { source: isSearchEngineHost(host) ? 'organic' : 'referral', network: null };
  }

  return { source: 'direct', network: null };
}

/** Тип устройства по User-Agent. Грубо, но для отчёта «мобильные против
 *  десктопа» точность выше не нужна. */
export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export function deviceTypeFromUserAgent(userAgent: string | null | undefined): DeviceType {
  const ua = userAgent ?? '';
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Случайный идентификатор сессии из браузера: не догадка сервера, а то, что
 *  клиент сам сгенерировал. Формат ограничен, чтобы в поле нельзя было
 *  положить что угодно. */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/**
 * Что клиент сообщает о начале сессии. Реферер приходит уже хостом, а
 * `landingPath` — без строки запроса: метки и идентификаторы из неё
 * передаются отдельными полями, а остальное (в том числе поисковые
 * фильтры) в базе оседать не должно.
 */
export const trackSessionSchema = z.object({
  sessionId: sessionIdSchema,
  landingPath: z
    .string()
    .max(300)
    .regex(/^\/[^?#]*$/),
  referrerHost: z.string().max(253).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  /** Идентификатор клика сети. Сервер сохраняет его только при согласии
   *  (или отключённом `ANALYTICS_REQUIRE_CONSENT`). */
  clickId: z.string().max(200).optional(),
  /** Посетитель согласился на сохранение идентификатора клика. Баннера
   *  пока нет, клиент всегда шлёт `false`. */
  consent: z.boolean().default(false),
});
export type TrackSession = z.infer<typeof trackSessionSchema>;

/**
 * Тело маяков просмотра и клика: сессия, к которой относится событие, плюс
 * сигналы для антибот-правил (фаза 3). `interacted` и `msSincePageLoad`
 * нужны только контактным событиям (см. `CONTACT_EVENT_KINDS` в `bot.ts`) —
 * у просмотра их не спрашиваем, скроллить или ждать перед ним нечего.
 */
export const trackEventContextSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  /** Был ли на странице скролл, клик или касание до этого события. */
  interacted: z.boolean().optional(),
  /** Сколько миллисекунд прошло с загрузки страницы. Сутки — практический
   *  потолок: значение больше него не несёт информации для правила. */
  msSincePageLoad: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .optional(),
});
export type TrackEventContext = z.infer<typeof trackEventContextSchema>;
