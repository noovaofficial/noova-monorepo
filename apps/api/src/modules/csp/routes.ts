import type { FastifyPluginAsync } from 'fastify';
import { isExtensionNoise, parseCspReport } from './report.js';

/**
 * Приём отчётов браузера о нарушениях Content-Security-Policy сайта.
 *
 * Отчёты только пишутся в лог (`нарушение CSP`): по ним решают, можно ли
 * переключать политику из режима отчёта в блокировку, — см.
 * `apps/web/src/shared/csp.ts`. Прислать отчёт может кто угодно, поэтому
 * тело маленькое, поля обрезаны, а лимит запросов свой.
 */
export const cspRoutes: FastifyPluginAsync = async (fastify) => {
  // Браузеры шлют отчёт со своим типом содержимого; разбираем его сами.
  for (const type of ['application/csp-report', 'application/reports+json', 'application/json']) {
    fastify.addContentTypeParser(
      type,
      { parseAs: 'string', bodyLimit: 16 * 1024 },
      (_req, body, done) => done(null, body),
    );
  }

  fastify.post(
    '/csp-report',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { hide: true } },
    async (request, reply) => {
      const raw = typeof request.body === 'string' ? request.body : '';
      for (const violation of parseCspReport(raw)) {
        if (isExtensionNoise(violation)) continue;
        request.log.warn({ csp: violation }, 'нарушение CSP');
      }
      return reply.status(204).send();
    },
  );
};
