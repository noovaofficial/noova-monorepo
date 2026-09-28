/**
 * Причины, по которым событие или сессию считаем ботом. Помечаем, не
 * удаляем: отчёт и антифрод должны уметь объяснить, что именно сработало,
 * а не просто вычесть строку из подсчёта.
 *
 * `datacenter` (IP из диапазона хостинга/дата-центра) сюда сознательно не
 * входит: без источника данных по ASN → диапазоны — платного или регулярно
 * обновляемого — проверка была бы либо пустой, либо неточной, а притворяться,
 * что она есть, хуже, чем её не иметь. Добавится вместе с источником данных.
 */
export const BOT_REASONS = ['ua', 'no_interaction', 'too_fast', 'velocity'] as const;
export type BotReason = (typeof BOT_REASONS)[number];

/**
 * Два события, которые вместе называем «контактом»: увидел номер и перешёл
 * по нему. В спеке продукта это четыре разных названия (`contact_reveal`,
 * `call_click`, `whatsapp_click`, `telegram_click`), здесь — один
 * `contact_click` с полем `contactType`, потому что канал не меняет ни
 * смысла события, ни антибот-правил для него. Единственное общее место, а
 * не проверка по месту: чтобы «контакт» в отчёте и в антифроде не разошёлся.
 */
export const CONTACT_EVENT_KINDS = ['contact_reveal', 'contact_click'] as const;
export type ContactEventKind = (typeof CONTACT_EVENT_KINDS)[number];

/**
 * User-Agent содержит одну из этих подстрок — практически наверняка не
 * человек за браузером: поисковые роботы и SEO-краулеры, сборщики
 * метаданных для превью ссылок в мессенджерах и соцсетях, headless-браузеры
 * и типовые HTTP-библиотеки. Список ловит явных ботов, которые себя не
 * скрывают; маскирующихся под настоящий браузер он не поймает — для них
 * есть остальные правила (интервал до клика, скорость просмотров).
 */
const BOT_UA_PATTERNS: readonly RegExp[] = [
  /bot|crawl|spider|slurp|scrape/i,
  /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|applebot|petalbot|bytespider/i,
  /ahrefsbot|semrushbot|mj12bot|dotbot|blexbot|seznambot|sogou/i,
  /facebookexternalhit|facebookcatalog|twitterbot|slackbot|discordbot|telegrambot|whatsapp|linkedinbot|pinterest|embedly|quora link preview|skypeuripreview|vkshare|redditbot/i,
  /headlesschrome|phantomjs|puppeteer|playwright|selenium|electron/i,
  /curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|libwww-perl|java\/|node-fetch|axios\//i,
];

/** true для пустого, отсутствующего или явно ботовского User-Agent. Пустой
 *  считаем ботом: настоящий браузер его всегда отправляет. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  if (!ua) return true;
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

/** Контактное событие быстрее этого времени после загрузки страницы —
 *  человек не успел бы прочитать номер и нажать. */
export const TOO_FAST_MS = 1500;

/** Окно и порог для правила «слишком много анкет подряд»: не про интерес
 *  посетителя, а про перебор каталога скриптом. */
export const VELOCITY_WINDOW_SECONDS = 5 * 60;
export const VELOCITY_MAX_VIEWS = 30;
