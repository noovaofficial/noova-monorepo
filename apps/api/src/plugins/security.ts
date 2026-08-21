import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import underPressure from '@fastify/under-pressure';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { corsOrigins, env } from '../env.js';

const securityPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(sensible);
  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, {
    origin: corsOrigins,
    // Куку сессии браузер пришлёт только при явном разрешении.
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  await fastify.register(cookie);
  // Загрузка фотографий. Ограничения дублируются в обработчике: этот лимит
  // рвёт поток, а внятное сообщение пользователю даёт уже маршрут.
  await fastify.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
  });
  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    /**
     * Серверный рендер фронта — не посетитель. Все его запросы приходят с
     * одного адреса (в проде это контейнер `web`), и без освобождения лимит
     * одного «посетителя» становится потолком на рендер всего сайта: главная
     * стоит пять запросов, каталог — два, и 120 в минуту кончаются на
     * двух десятках просмотров.
     *
     * Опознаём по общему секрету, а не по адресу: адрес контейнера меняется
     * при пересоздании, а «частная сеть» перестала бы работать ровно в тот
     * момент, когда кто-то выставит API наружу.
     */
    allowList: (request) =>
      env.INTERNAL_API_TOKEN !== '' &&
      request.headers['x-noova-internal'] === env.INTERNAL_API_TOKEN,
  });

  // Под нагрузкой отдаём 503 вместо того, чтобы уронить процесс по памяти.
  await fastify.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 512 * 1024 * 1024,
    maxRssBytes: 768 * 1024 * 1024,
    retryAfter: 15,
    exposeStatusRoute: false,
  });
};

export default fp(securityPlugin, { name: 'security' });
