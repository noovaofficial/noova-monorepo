import {
  type BotReason,
  CONTACT_EVENT_KINDS,
  isBotUserAgent,
  TOO_FAST_MS,
  VELOCITY_MAX_VIEWS,
  VELOCITY_WINDOW_SECONDS,
} from '@noova/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProfileEventKind } from '../../generated/prisma/enums.js';

export type BotClassification = { isBot: boolean; botReason: BotReason | null };

const notBot: BotClassification = { isBot: false, botReason: null };

/**
 * Разметка сессии по правилу 1 (User-Agent): всё, что доступно уже на
 * первом обращении браузера, без сведений о поведении на странице.
 *
 * Правило 2 спеки («IP из диапазона дата-центра/хостинга») здесь
 * сознательно отсутствует: без источника данных ASN → диапазоны оно было бы
 * либо пустым, либо неточным — см. комментарий у `BOT_REASONS` в
 * `packages/shared/src/bot.ts`. Добавится вместе с источником данных.
 */
export function classifySessionBot(request: FastifyRequest): BotClassification {
  if (isBotUserAgent(request.headers['user-agent'])) return { isBot: true, botReason: 'ua' };
  return notBot;
}

/**
 * Не более `VELOCITY_MAX_VIEWS` просмотров анкет от одной сессии за
 * `VELOCITY_WINDOW_SECONDS`. Счётчик в Redis, а не в журнале: проверка по
 * таблице на каждый просмотр — это чтение перед записью на самом горячем
 * маршруте каталога.
 *
 * Недоступность Redis трактуем как «не сработало»: то же решение, что и у
 * дедупликации в `events.ts` — потерянная проверка безопаснее, чем
 * встающий на ней маяк.
 */
async function tooManyViews(fastify: FastifyInstance, sessionId: string): Promise<boolean> {
  try {
    const key = `ev:velocity:${sessionId}`;
    const count = await fastify.redis.incr(key);
    if (count === 1) await fastify.redis.expire(key, VELOCITY_WINDOW_SECONDS);
    return count > VELOCITY_MAX_VIEWS;
  } catch (error) {
    fastify.log.warn({ err: error }, 'не удалось проверить частоту просмотров');
    return false;
  }
}

export type EventBotInput = {
  kind: ProfileEventKind;
  sessionId?: string;
  /** Был ли на странице скролл, клик или касание до события. Только у
   *  контактных событий — у просмотра взаимодействовать не с чем. */
  interacted?: boolean;
  /** Сколько миллисекунд прошло с загрузки страницы до события. */
  msSincePageLoad?: number;
};

/**
 * Разметка одного события. Правила проверяются по порядку из фазы 3
 * спеки — первое сработавшее и определяет причину. Пункт 1 (User-Agent)
 * общий для любого события; 3 и 4 — только для контактных; 5 — только для
 * просмотра, и требует сессии: без неё считать скорость не по чему.
 * Правило 2 (дата-центр) пока отключено — см. `classifySessionBot`.
 */
export async function classifyEventBot(
  fastify: FastifyInstance,
  request: FastifyRequest,
  input: EventBotInput,
): Promise<BotClassification> {
  // Просмотр всегда учитывается в счётчике скорости — вне зависимости от
  // того, окажется ли он ботом по другой причине: иначе доля ботов по
  // правилу 5 плыла бы от того, в каком порядке сработали другие правила.
  const velocityHit =
    input.kind === 'view' && input.sessionId ? await tooManyViews(fastify, input.sessionId) : false;

  const session = classifySessionBot(request);
  if (session.isBot) return session;

  const isContactEvent = (CONTACT_EVENT_KINDS as readonly string[]).includes(input.kind);
  if (isContactEvent && input.interacted === false)
    return { isBot: true, botReason: 'no_interaction' };
  if (
    isContactEvent &&
    input.msSincePageLoad !== undefined &&
    input.msSincePageLoad < TOO_FAST_MS
  ) {
    return { isBot: true, botReason: 'too_fast' };
  }

  if (velocityHit) return { isBot: true, botReason: 'velocity' };

  return notBot;
}
