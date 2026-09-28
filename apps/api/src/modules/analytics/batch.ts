import type { EventBatch } from '@noova/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { classifyEventBot } from './bot.js';
import { hashIp, isVisitor } from './events.js';

/** 60 батчей в минуту с одного адреса (спека 1.3). Общий лимит `/api/v1`
 *  тут не годится: батч и одиночный маяк — разная единица счёта, а лимит
 *  ниже нужен именно на «сколько раз браузер прислал очередь», не на общий
 *  трафик API с этого адреса. */
const BATCH_RATE_LIMIT = 60;
const BATCH_RATE_WINDOW_SECONDS = 60;

/**
 * Превышение лимита по батчам с одного адреса. В отличие от раскрытия
 * контактов, здесь не 429: лишний батч молча пропадает (спека 1.3) —
 * трекер и так ничего не ждёт в ответ, сообщать ему о лимите некому.
 * Недоступность Redis трактуем как «лимит не превышен», тем же решением,
 * что и у остальных проверок на Redis в этом модуле.
 */
async function isRateLimited(fastify: FastifyInstance, ipHash: string): Promise<boolean> {
  try {
    const key = `ev:batch:${ipHash}`;
    const count = await fastify.redis.incr(key);
    if (count === 1) await fastify.redis.expire(key, BATCH_RATE_WINDOW_SECONDS);
    return count > BATCH_RATE_LIMIT;
  } catch (error) {
    fastify.log.warn({ err: error }, 'не удалось проверить лимит батчей аналитики');
    return false;
  }
}

/**
 * Записывает батч каталожных событий (`page_view`, `gallery_open`,
 * `search_filter`, фаза 1). Не бросает: сбой любого шага — это молчаливая
 * потеря статистики, как и у остальных маяков, а не 500 для трекера,
 * который ответа не ждёт и повторить всё равно не сможет.
 *
 * Владелец и персонал исключены той же проверкой, что и в `recordProfileEvent`
 * — их собственный просмотр каталога не посетительский интерес.
 */
export async function recordEventBatch(
  fastify: FastifyInstance,
  request: FastifyRequest,
  events: EventBatch,
): Promise<void> {
  if (!isVisitor(request)) return;

  const ipHash = hashIp(request.ip);
  if (await isRateLimited(fastify, ipHash)) return;

  // Один запрос на весь батч вместо одного на событие: слагов в нём почти
  // всегда один-два (все события одной страницы), но при нескольких —
  // экономия ровно в размер батча.
  const slugs = [
    ...new Set(events.map((event) => event.profileSlug).filter((s): s is string => !!s)),
  ];
  const profiles = slugs.length
    ? await fastify.prisma.profile.findMany({
        where: { slug: { in: slugs }, status: 'published' },
        select: { id: true, slug: true, kind: true, city: { select: { slug: true } } },
      })
    : [];
  const bySlug = new Map(profiles.map((profile) => [profile.slug, profile]));

  const userId = request.session?.userId ?? null;

  for (const event of events) {
    // gallery_open без опознанной анкеты нечего открывать: слаг битый,
    // чужой или анкета уже снята с публикации — событие просто пропадает,
    // как пропало бы 404 у прямого запроса раскрытия той же анкеты.
    const profile = event.profileSlug ? bySlug.get(event.profileSlug) : undefined;
    if (event.name === 'gallery_open' && !profile) continue;

    const { isBot, botReason } = await classifyEventBot(fastify, request, {
      kind: event.name,
      sessionId: event.sessionId,
    });

    fastify.eventBuffer.push({
      profileId: profile?.id ?? null,
      kind: event.name,
      userId,
      ipHash,
      sessionId: event.sessionId ?? null,
      city: profile?.city.slug ?? event.city ?? null,
      category: profile?.kind ?? event.category ?? null,
      path: event.path,
      isBot,
      botReason,
    });
  }
}
