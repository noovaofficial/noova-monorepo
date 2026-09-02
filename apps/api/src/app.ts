import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { isProduction } from './env.js';
import { loggerOptions } from './logger.js';
import { accountRoutes } from './modules/account/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { analyticsRoutes } from './modules/analytics/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { billingRoutes } from './modules/billing/routes.js';
import { commentRoutes } from './modules/comments/routes.js';
import { companyRoutes } from './modules/company/routes.js';
import { favoriteRoutes } from './modules/favorites/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { locationRoutes } from './modules/locations/routes.js';
import { moderationRoutes } from './modules/moderation/routes.js';
import { photoRoutes } from './modules/photos/routes.js';
import { revealRoutes } from './modules/profiles/reveal.js';
import { profileRoutes } from './modules/profiles/routes.js';
import { promoRoutes } from './modules/promo/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { serviceCatalogRoutes } from './modules/service-catalog/routes.js';
import { verificationRoutes } from './modules/verification/routes.js';
import presencePlugin from './plugins/presence.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import revalidatePlugin from './plugins/revalidate.js';
import securityPlugin from './plugins/security.js';
import sessionPlugin from './plugins/session.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    /**
     * Ровно один доверенный переход — Caddy. `true` означало бы «верить всей
     * цепочке X-Forwarded-For», а её левый край пишет клиент: подставив
     * заголовок, он получал бы новую корзину лимита на каждый запрос и
     * обходил бы, в частности, лимит раскрытия контактов (N-08).
     */
    // Функция, а не число: числовой литерал в этом объекте уводит вывод типов
    // Fastify в http2-перегрузку, и сборка перестаёт собираться.
    trustProxy: (_address: string, hop: number) => hop === 0,
    // Обрыв соединения клиентом не должен считаться ошибкой приложения.
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(securityPlugin);
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(sessionPlugin);
  await app.register(revalidatePlugin);
  await app.register(presencePlugin);

  if (!isProduction) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Noova API', version: '0.1.0' },
        servers: [{ url: '/api/v1' }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // Обработчик ошибок ставится до маршрутов: Fastify привязывает его к контексту
  // в момент регистрации роута, и объявленный позже он на них не распространяется.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Ошибка валидации входа — это 400 с разбором по полям, а не 500 и не
    // строка от Fastify: клиенту нужно знать, какое поле не прошло.
    if (hasZodFastifySchemaValidationErrors(error) || error.code === 'FST_ERR_VALIDATION') {
      request.log.info({ issues: error.validation }, 'некорректные параметры запроса');
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Некорректные параметры запроса',
        statusCode: 400,
        // Отдаём поле и код правила, но не текст: формулировки живут
        // в словарях фронта, иначе их не перевести на три языка.
        issues: (error.validation ?? []).map((issue) => ({
          field: String(issue.instancePath ?? '').replace(/^\//, '') || undefined,
          code: issue.keyword,
        })),
      });
    }

    // Расхождение ответа со схемой — наша ошибка, а не клиента.
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, method: error.method, url: error.url },
        'ответ не соответствует схеме',
      );
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Внутренняя ошибка сервера',
        statusCode: 500,
      });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'необработанная ошибка запроса');
    }

    // Наружу отдаём только безопасный текст: внутренние сообщения могут
    // содержать фрагменты запросов и персональные данные.
    return reply.status(status).send({
      error: status >= 500 ? 'Internal Server Error' : error.name,
      message: status >= 500 ? 'Внутренняя ошибка сервера' : error.message,
      statusCode: status,
    });
  });

  await app.register(healthRoutes);
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(accountRoutes);
      await api.register(photoRoutes);
      await api.register(moderationRoutes);
      await api.register(adminRoutes);
      await api.register(companyRoutes);
      await api.register(locationRoutes);
      await api.register(serviceCatalogRoutes);
      await api.register(profileRoutes);
      await api.register(revealRoutes);
      await api.register(favoriteRoutes);
      await api.register(commentRoutes);
      await api.register(reportRoutes);
      await api.register(promoRoutes);
      await api.register(billingRoutes);
      await api.register(verificationRoutes);
      await api.register(analyticsRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
