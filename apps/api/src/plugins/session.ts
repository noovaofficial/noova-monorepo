import { randomBytes } from 'node:crypto';
import type { UserRole } from '@noova/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env, isProduction } from '../env.js';

export type SessionUser = {
  userId: string;
  role: UserRole;
};

declare module 'fastify' {
  interface FastifyInstance {
    createSession(reply: FastifyReply, user: SessionUser): Promise<void>;
    destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    destroyAllSessions(userId: string): Promise<void>;
    /** 401, если сессии нет. Использовать как onRequest-хук. */
    requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** 403, если роль не подходит. */
    requireRole(...roles: UserRole[]): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    session: SessionUser | null;
  }
}

/**
 * Достаёт сессию после requireAuth. Существует, чтобы не писать `!` в каждом
 * защищённом маршруте: если хук забудут повесить, здесь будет внятная ошибка,
 * а не падение на undefined в глубине запроса.
 */
export function requireSession(request: FastifyRequest): SessionUser {
  if (!request.session) {
    throw new Error('requireSession вызван на маршруте без requireAuth');
  }
  return request.session;
}

/** Публичный признак входа для фронта. Секрета не содержит. */
const SIGNED_IN_COOKIE = 'noova_signed_in';

/**
 * Роль для фронта — **только подсказка интерфейсу**, не разграничение доступа.
 * Кука доступна JS и подделывается тривиально; ею решается лишь то, куда
 * отправить пользователя после входа и что показать в шапке. Любое реальное
 * разрешение проверяется на сервере по сессии в Redis.
 */
const ROLE_COOKIE = 'noova_role';

const sessionKey = (id: string) => `session:${id}`;
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;

/**
 * Сессии серверные, а не JWT: учётку нужно уметь мгновенно отзывать при бане
 * или жалобе, а выданный JWT отозвать нельзя.
 */
const sessionPlugin: FastifyPluginAsync = async (fastify) => {
  const ttlSeconds = env.SESSION_TTL_DAYS * 24 * 60 * 60;

  fastify.decorateRequest('session', null);

  async function store(sessionId: string, user: SessionUser) {
    await fastify.redis
      .multi()
      .set(sessionKey(sessionId), JSON.stringify(user), 'EX', ttlSeconds)
      // Обратный индекс нужен, чтобы погасить все сессии пользователя разом.
      .sadd(userSessionsKey(user.userId), sessionId)
      .expire(userSessionsKey(user.userId), ttlSeconds)
      .exec();
  }

  fastify.decorate('createSession', async (reply: FastifyReply, user: SessionUser) => {
    // Новый идентификатор на каждый вход — защита от фиксации сессии.
    const sessionId = randomBytes(32).toString('base64url');
    await store(sessionId, user);

    reply.setCookie(env.SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: ttlSeconds,
    });

    // Вторая кука — только признак «вход выполнен», без секрета и доступная JS.
    // Нужна фронту: страницы статические, сессию на сервере не прочитать
    // (это убило бы SSG), а без подсказки шапка на мгновение показала бы
    // кнопку «Войти» уже вошедшему пользователю.
    const publicCookie = {
      path: '/',
      httpOnly: false,
      sameSite: 'lax' as const,
      secure: isProduction,
      maxAge: ttlSeconds,
    };

    reply.setCookie(SIGNED_IN_COOKIE, '1', publicCookie);
    reply.setCookie(ROLE_COOKIE, user.role, publicCookie);
  });

  fastify.decorate('destroySession', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = request.cookies[env.SESSION_COOKIE];
    if (sessionId) {
      const raw = await fastify.redis.get(sessionKey(sessionId));
      if (raw) {
        const user = JSON.parse(raw) as SessionUser;
        await fastify.redis.srem(userSessionsKey(user.userId), sessionId);
      }
      await fastify.redis.del(sessionKey(sessionId));
    }
    reply.clearCookie(env.SESSION_COOKIE, { path: '/' });
    reply.clearCookie(SIGNED_IN_COOKIE, { path: '/' });
    reply.clearCookie(ROLE_COOKIE, { path: '/' });
  });

  fastify.decorate('destroyAllSessions', async (userId: string) => {
    const ids = await fastify.redis.smembers(userSessionsKey(userId));
    if (ids.length > 0) {
      await fastify.redis.del(...ids.map(sessionKey), userSessionsKey(userId));
    }
  });

  // Читаем сессию на каждом запросе, но не требуем её: публичные роуты
  // должны работать и анонимно.
  fastify.addHook('onRequest', async (request) => {
    const sessionId = request.cookies[env.SESSION_COOKIE];
    if (!sessionId) return;

    const raw = await fastify.redis.get(sessionKey(sessionId));
    if (!raw) return;

    request.session = JSON.parse(raw) as SessionUser;
    // Скользящее продление: активный пользователь не выкидывается через 30 дней.
    await fastify.redis.expire(sessionKey(sessionId), ttlSeconds);
  });

  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.session) {
      await reply.status(401).send({
        error: 'Unauthorized',
        message: 'Требуется вход',
        statusCode: 401,
      });
    }
  });

  fastify.decorate(
    'requireRole',
    (...roles: UserRole[]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.session) {
          await reply.status(401).send({
            error: 'Unauthorized',
            message: 'Требуется вход',
            statusCode: 401,
          });
          return;
        }
        if (!roles.includes(request.session.role)) {
          await reply.status(403).send({
            error: 'Forbidden',
            message: 'Недостаточно прав',
            statusCode: 403,
          });
        }
      },
  );
};

export default fp(sessionPlugin, { name: 'session', dependencies: ['redis'] });
