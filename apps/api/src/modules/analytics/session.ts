import {
  classifySource,
  cleanUtm,
  deviceTypeFromUserAgent,
  hostFromUrl,
  normalizeHost,
  type TrackSession,
} from '@noova/shared';
import type { FastifyRequest } from 'fastify';
import { corsOrigins, env } from '../../env.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { classifySessionBot } from './bot.js';
import { hashIp } from './events.js';

/** Наши хосты: заход с них не считается рефералом. */
const OWN_HOSTS = [env.PUBLIC_SITE_URL, ...corsOrigins]
  .map((url) => hostFromUrl(url))
  .filter((host): host is string => host !== null);

/**
 * Хэш посетителя: адрес плюс User-Agent, чтобы два устройства за одним
 * адресом (семья, мобильный оператор) не сливались в одного.
 */
export function visitorHash(request: FastifyRequest): string {
  return hashIp(`${request.ip}|${request.headers['user-agent'] ?? ''}`);
}

/**
 * Создаёт сессию, если такой ещё нет. Повторный вызов с тем же `sessionId`
 * ничего не меняет: источник определяет первый заход, и «перекрасить»
 * сессию, прислав другие метки, нельзя.
 *
 * Идентификатор клика сети пишется, только если согласие не требуется или
 * посетитель его дал.
 */
export async function recordSession(
  prisma: PrismaClient,
  request: FastifyRequest,
  input: TrackSession,
  now: Date = new Date(),
): Promise<boolean> {
  const referrerHost = normalizeHost(input.referrerHost);
  const { source, network } = classifySource({
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    referrerHost,
    ownHosts: OWN_HOSTS,
  });

  const mayKeepClickId = !env.ANALYTICS_REQUIRE_CONSENT || input.consent;
  const { isBot, botReason } = classifySessionBot(request);

  const { count } = await prisma.analyticsSession.createMany({
    data: {
      id: input.sessionId,
      visitorHash: visitorHash(request),
      isBot,
      botReason,
      utmSource: cleanUtm(input.utmSource),
      utmMedium: cleanUtm(input.utmMedium),
      utmCampaign: cleanUtm(input.utmCampaign),
      utmContent: cleanUtm(input.utmContent),
      network,
      networkClickId: mayKeepClickId && network ? (input.clickId ?? null) : null,
      referrerHost,
      source,
      landingPath: input.landingPath,
      deviceType: deviceTypeFromUserAgent(request.headers['user-agent']),
      startedAt: now,
    },
    skipDuplicates: true,
  });

  return count > 0;
}

/** Чистка сессий по тому же сроку, что и журнал событий. */
export async function purgeAnalyticsSessions(
  prisma: PrismaClient,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.analyticsSession.deleteMany({
    where: { startedAt: { lt: cutoff } },
  });
  return count;
}
