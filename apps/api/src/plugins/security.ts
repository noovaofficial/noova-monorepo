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

/**
 * Браузер шлёт клиентские запросы (раскрытие контактов, избранное) на
 * `NEXT_PUBLIC_API_URL` — это апекс, а не сам поддомен, с которого открыта
 * страница. Со страницы агентства (N-38, `{slug}.{домен}`) такой запрос
 * межсайтовый по Origin, и статический список `CORS_ORIGINS` его не знает
 * заранее — слугов агентств сколько угодно. Разрешаем не по списку, а по
 * совпадению с хостом `PUBLIC_SITE_URL` или его поддоменом.
 */
function isAllowedOrigin(origin: string): boolean {
  if (corsOrigins.includes(origin)) return true;
  try {
    const site = new URL(env.PUBLIC_SITE_URL);
    const requested = new URL(origin);
    return requested.protocol === site.protocol && requested.hostname.endsWith(`.${site.hostname}`);
  } catch {
    return false;
  }
}

/**
 * Ключ лимита запросов. IPv4 — сам адрес. IPv6 — подсеть /64: провайдер
 * выдаёт абоненту её целиком, и счёт по полному адресу давал бы одному
 * человеку 2^64 отдельных квот — лимит раскрытия контактов обходился бы
 * простой сменой адреса внутри своей же подсети.
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  // IPv4 в обёртке IPv6 (`::ffff:1.2.3.4`) — это один IPv4-адрес.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];

  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // `::` заменяет недостающие нулевые группы — разворачиваем до восьми.
  const groups = ip.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

const securityPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(sensible);
  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Без Origin — не браузерный кросс-сайт запрос (curl, сервер-сервер):
      // проверять нечего, CORS на такие запросы не распространяется.
      callback(null, !origin || isAllowedOrigin(origin));
    },
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
    keyGenerator: (request) => rateLimitKey(request.ip),
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
