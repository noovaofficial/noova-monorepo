import { RESERVED_SUBDOMAINS } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../env.js';

/**
 * Поддомен агентства (N-38): `{slug}.{домен}` → `/company/{slug}`. Caddy
 * перед выпуском сертификата on-demand TLS спрашивает этот маршрут —
 * не любой хост из интернета получит сертификат нашего имени, только тот,
 * что реально ведёт на активную компанию.
 *
 * Без авторизации и лимита, как `/healthz`: зовёт инфраструктура, а не
 * пользователь, и отказ здесь должен быть мгновенным.
 */
export const domainCheckRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/internal/domain-check',
    {
      config: { rateLimit: false },
      // Только 200 в схеме: Caddy смотрит исключительно на код ответа, а тело
      // отказа не нормируем под её формат — не листаем его в схеме, и
      // Fastify пропускает такой ответ без попытки сериализовать по чужой
      // схеме (несовпадение с общим форматом ошибок дало бы 500 вместо 400/404).
      schema: {
        tags: ['health'],
        querystring: z.object({ domain: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const siteHost = new URL(env.PUBLIC_SITE_URL).hostname;
      const domain = request.query.domain.toLowerCase();
      const suffix = `.${siteHost}`;

      if (!domain.endsWith(suffix)) {
        throw fastify.httpErrors.badRequest('Домен не относится к этому сайту');
      }

      const slug = domain.slice(0, -suffix.length);
      if (!slug || (RESERVED_SUBDOMAINS as readonly string[]).includes(slug)) {
        throw fastify.httpErrors.notFound('Поддомен зарезервирован');
      }

      const company = await fastify.prisma.company.findUnique({
        where: { slug },
        select: { isActive: true },
      });
      if (!company?.isActive) throw fastify.httpErrors.notFound('Компания не найдена');

      return { ok: true as const };
    },
  );
};
