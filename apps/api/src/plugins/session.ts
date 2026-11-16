import { randomBytes } from 'node:crypto';
import type { UserRole } from '@noova/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env, isProduction } from '../env.js';

/**
 * Состояние второго фактора в сессии сотрудника:
 *  - `ok` — код введён, сессия полноправная;
 *  - `pending` — пароль верный, код ещё не введён;
 *  - `setup` — второй фактор не настроен, доступна только настройка.
 * У посетителей и рекламодателей поля нет: второй фактор им не нужен.
 */
export type MfaState = 'ok' | 'pending' | 'setup';

export type SessionUser = {
  userId: string;
  role: UserRole;
  mfa?: MfaState;
};

/** Роли, которым второй фактор обязателен. */
export const MFA_ROLES: readonly UserRole[] = ['admin', 'moderator'];

/**
 * Решает, что делать с прочитанной сессией. Чистая функция: правило, от
 * которого зависит доступ ко всей модерации и админке, должно проверяться
 * тестом, а не только чтением хука.
 *
 *  - `full` — сессия действует как обычно;
 *  - `limited` — второй фактор не пройден, но маршрут как раз для этого
 *    (ввод кода, настройка, выход, «кто я»);
 *  - `blocked` — второй фактор не пройден, маршрут закрыт: запрос идёт как
 *    анонимный, а отказ объясняет, чего не хватает;
 *  - `invalid` — сессия сотрудника без отметки о втором факторе (выдана до
 *    его появления): считаем её несуществующей, нужен новый вход.
 */
export function sessionAccess(
  session: SessionUser,
  allowPendingMfa: boolean,
): 'full' | 'limited' | 'blocked' | 'invalid' {
  if (!MFA_ROLES.includes(session.role)) return 'full';
  if (session.mfa === 'ok') return 'full';
  if (session.mfa !== 'pending' && session.mfa !== 'setup') return 'invalid';
  return allowPendingMfa ? 'limited' : 'blocked';
}

declare module 'fastify' {
  interface FastifyInstance {
    createSession(reply: FastifyReply, user: SessionUser): Promise<void>;
    destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    /**
     * Меняет сессию запроса на новую — с другим идентификатором. Нужна при
     * смене уровня доступа (второй фактор пройден): прежний идентификатор,
     * если его успели подсмотреть, не должен унаследовать новые права.
     */
    replaceSession(request: FastifyRequest, reply: FastifyReply, user: SessionUser): Promise<void>;
    destroyAllSessions(userId: string): Promise<void>;
    /** 401, если сессии нет. Использовать как onRequest-хук. */
    requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** 403, если роль не подходит. */
    requireRole(...roles: UserRole[]): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    session: SessionUser | null;
    /** Сессия есть, но закрыта до второго фактора — см. `sessionAccess`. */
    mfaBlocked: Exclude<MfaState, 'ok'> | null;
  }

  interface FastifyContextConfig {
    /**
     * Маршрут доступен сотруднику, ещё не прошедшему второй фактор. Ставить
     * только на то, без чего его не пройти: ввод кода, настройку, выход.
     */
    allowPendingMfa?: boolean;
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
 * Домен куки. Без него кука host-only и привязана строго к апексу — на
 * поддомене агентства (N-38, `{slug}.{домен}`) браузер её вообще не пришлёт,
 * и вошедший посетитель на странице агентства выглядел бы гостем: раскрытие
 * контактов, избранное потеряли бы личность сессии. `Domain=` без ведущей
 * точки уже покрывает и апекс, и все поддомены (RFC 6265).
 *
 * На localhost нет ни поддоменов, ни смысла: `Domain=localhost` браузеры
 * трактуют по-разному, и без явной необходимости лучше host-only, как раньше.
 */
const cookieDomain = (() => {
  const host = new URL(env.PUBLIC_SITE_URL).hostname;
  return host === 'localhost' || host === '127.0.0.1' ? undefined : host;
})();

/**
 * Сессии серверные, а не JWT: учётку нужно уметь мгновенно отзывать при бане
 * или жалобе, а выданный JWT отозвать нельзя.
 */
const sessionPlugin: FastifyPluginAsync = async (fastify) => {
  const ttlSeconds = env.SESSION_TTL_DAYS * 24 * 60 * 60;

  fastify.decorateRequest('session', null);
  fastify.decorateRequest('mfaBlocked', null);

  /** Сколько живёт сессия, не дошедшая до второго фактора. */
  const pendingTtlSeconds = 15 * 60;

  async function store(sessionId: string, user: SessionUser) {
    const ttl = sessionAccess(user, false) === 'full' ? ttlSeconds : pendingTtlSeconds;
    await fastify.redis
      .multi()
      .set(sessionKey(sessionId), JSON.stringify(user), 'EX', ttl)
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
      domain: cookieDomain,
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
      domain: cookieDomain,
      httpOnly: false,
      sameSite: 'lax' as const,
      secure: isProduction,
      maxAge: ttlSeconds,
    };

    reply.setCookie(SIGNED_IN_COOKIE, '1', publicCookie);
    // Кука роли уводит сотрудника с витрины в модерацию (proxy.ts фронта).
    // До второго фактора ему там делать нечего — куку не ставим.
    if (sessionAccess(user, false) === 'full') {
      reply.setCookie(ROLE_COOKIE, user.role, publicCookie);
    } else {
      reply.clearCookie(ROLE_COOKIE, { path: '/', domain: cookieDomain });
    }
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
    // Domain должен совпадать с тем, что стоял при setCookie — иначе браузер
    // видит в этом другую куку и не очищает ту, что реально прочитана.
    reply.clearCookie(env.SESSION_COOKIE, { path: '/', domain: cookieDomain });
    reply.clearCookie(SIGNED_IN_COOKIE, { path: '/', domain: cookieDomain });
    reply.clearCookie(ROLE_COOKIE, { path: '/', domain: cookieDomain });
  });

  fastify.decorate(
    'replaceSession',
    async (request: FastifyRequest, reply: FastifyReply, user: SessionUser) => {
      const oldId = request.cookies[env.SESSION_COOKIE];
      if (oldId) {
        await fastify.redis
          .multi()
          .del(sessionKey(oldId))
          .srem(userSessionsKey(user.userId), oldId)
          .exec();
      }
      await fastify.createSession(reply, user);
    },
  );

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

    const session = JSON.parse(raw) as SessionUser;
    const access = sessionAccess(session, request.routeOptions.config?.allowPendingMfa === true);
    if (access === 'invalid') return;
    if (access === 'blocked') {
      // Запрос идёт как анонимный: публичные маршруты работают, закрытые
      // откажут — и скажут, что дело во втором факторе.
      request.mfaBlocked = session.mfa === 'setup' ? 'setup' : 'pending';
      return;
    }

    request.session = session;
    // Скользящее продление: активный пользователь не выкидывается через 30 дней.
    // Недошедшая до второго фактора сессия не продлевается: она живёт
    // столько, сколько нужно на ввод кода.
    if (access === 'full') await fastify.redis.expire(sessionKey(sessionId), ttlSeconds);
  });

  /** Отказ, когда сессии нет: 401 гостю, 403 с кодом — недошедшему до кода. */
  async function denyMissingSession(request: FastifyRequest, reply: FastifyReply) {
    if (request.mfaBlocked) {
      await reply.status(403).send({
        error: 'Forbidden',
        message: 'Требуется второй фактор',
        statusCode: 403,
        code: request.mfaBlocked === 'setup' ? 'mfa_setup_required' : 'mfa_required',
      });
      return;
    }
    await reply.status(401).send({
      error: 'Unauthorized',
      message: 'Требуется вход',
      statusCode: 401,
    });
  }

  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.session) await denyMissingSession(request, reply);
  });

  fastify.decorate(
    'requireRole',
    (...roles: UserRole[]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.session) {
          await denyMissingSession(request, reply);
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
