import { mfaCodeSchema, mfaEnabledSchema, mfaSetupSchema, mfaVerifiedSchema } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import QRCode from 'qrcode';
import { env, missingProductionSecrets } from '../../env.js';
import { requireSession } from '../../plugins/session.js';
import { withCode } from '../locations/country-lock.js';
import { clearMfaFailures, isMfaLocked, recordMfaFailure } from './login-guard.js';
import { toCurrentUser } from './mappers.js';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUrl,
  RECOVERY_CODE_COUNT,
  verifyTotp,
} from './totp.js';

const USER_INCLUDE = {
  clientProfile: true,
  country: { select: { code: true } },
  city: { select: { slug: true } },
} as const;

/** Имя, под которым запись видна в приложении-аутентификаторе. */
const ISSUER = 'Noova';

/**
 * Второй фактор админов и модераторов.
 *
 * Сюда попадает сессия, уже прошедшая пароль, но ещё не полноправная
 * (`allowPendingMfa`): все остальные маршруты для неё закрыты в
 * plugins/session.ts. Порядок:
 *
 *   вход → `setup` → POST /auth/mfa/setup → POST /auth/mfa/enable → `ok`
 *   вход → `pending` → POST /auth/mfa/verify → `ok`
 *
 * Отключить второй фактор самому нельзя — он обязателен. Потерявшему и
 * телефон, и резервные коды его сбрасывают скриптом `reset-mfa`.
 * Сброс пароля письмом второй фактор не трогает: иначе взлом почты снова
 * давал бы полный доступ.
 */
export const mfaRoutes: FastifyPluginAsyncZod = async (fastify) => {
  /** Без ключа шифрования секрет хранить нечем — честно отказываем. */
  function requireKey(): string {
    if (missingProductionSecrets(env, ['MFA_SECRET_KEY']).length > 0) {
      fastify.log.error('MFA_SECRET_KEY не задан: второй фактор недоступен');
      throw fastify.httpErrors.serviceUnavailable('Второй фактор не настроен на сервере');
    }
    return env.MFA_SECRET_KEY;
  }

  async function guardAttempts(userId: string) {
    if (await isMfaLocked(fastify.redis, userId)) {
      throw withCode(
        fastify.httpErrors.tooManyRequests('Слишком много неверных кодов. Попробуйте позже'),
        'mfa_locked',
      );
    }
  }

  async function wrongCode(userId: string): Promise<never> {
    await recordMfaFailure(fastify.redis, userId);
    throw withCode(fastify.httpErrors.unauthorized('Неверный код'), 'mfa_wrong_code');
  }

  const limits = { rateLimit: { max: 10, timeWindow: '1 minute', allowList: () => false } };

  /**
   * Начало настройки: новый секрет. Повторный вызов выдаёт другой секрет —
   * прежний черновик перестаёт действовать (человек мог закрыть страницу,
   * не досканировав).
   */
  fastify.post(
    '/auth/mfa/setup',
    {
      onRequest: fastify.requireAuth,
      config: { allowPendingMfa: true, ...limits },
      schema: { tags: ['auth'], response: { 200: mfaSetupSchema } },
    },
    async (request) => {
      const session = requireSession(request);
      // Только до включения. Уже настроенный фактор так не перезаписать:
      // иначе сессия, прошедшая лишь пароль, подменила бы его своим.
      if (session.mfa !== 'setup') throw fastify.httpErrors.forbidden('Второй фактор уже настроен');
      const key = requireKey();

      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, totpEnabledAt: true },
      });
      if (!user || user.totpEnabledAt) {
        throw fastify.httpErrors.forbidden('Второй фактор уже настроен');
      }

      const secret = generateTotpSecret();
      await fastify.prisma.user.update({
        where: { id: user.id },
        data: { totpSecret: encryptSecret(secret, key), totpLastStep: null },
      });
      return {
        secret,
        qrDataUrl: await QRCode.toDataURL(otpauthUrl(secret, user.email, ISSUER), {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 240,
        }),
      };
    },
  );

  /** Подтверждение настройки первым кодом. Выдаёт резервные коды — один раз. */
  fastify.post(
    '/auth/mfa/enable',
    {
      onRequest: fastify.requireAuth,
      config: { allowPendingMfa: true, ...limits },
      schema: { tags: ['auth'], body: mfaCodeSchema, response: { 200: mfaEnabledSchema } },
    },
    async (request, reply) => {
      const session = requireSession(request);
      if (session.mfa !== 'setup') throw fastify.httpErrors.forbidden('Второй фактор уже настроен');
      const key = requireKey();
      await guardAttempts(session.userId);

      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        include: USER_INCLUDE,
      });
      if (!user || user.totpEnabledAt || !user.totpSecret) {
        throw fastify.httpErrors.conflict('Сначала начните настройку');
      }
      const secret = decryptSecret(user.totpSecret, key);
      const step = secret ? verifyTotp(secret, request.body.code) : null;
      if (step === null) return wrongCode(user.id);

      const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
      const enabled = await fastify.prisma.$transaction(async (tx) => {
        // Условие в `where`: два одновременных подтверждения не выдадут два
        // набора резервных кодов.
        const updated = await tx.user.updateMany({
          where: { id: user.id, totpEnabledAt: null },
          data: { totpEnabledAt: new Date(), totpLastStep: step },
        });
        if (updated.count === 0) return false;
        await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
        await tx.mfaRecoveryCode.createMany({
          data: recoveryCodes.map((code) => ({
            userId: user.id,
            codeHash: hashRecoveryCode(code),
          })),
        });
        return true;
      });
      if (!enabled) throw fastify.httpErrors.conflict('Второй фактор уже настроен');

      await clearMfaFailures(fastify.redis, user.id);
      // Остальные сессии учётки — недошедшие до кода — больше не нужны.
      await fastify.destroyAllSessions(user.id);
      await fastify.replaceSession(request, reply, {
        userId: user.id,
        role: user.role,
        mfa: 'ok',
      });
      request.log.info({ userId: user.id }, 'второй фактор включён');
      return { user: toCurrentUser(user, 'ok'), recoveryCodes };
    },
  );

  /** Ввод кода при входе: шесть цифр из приложения или резервный код. */
  fastify.post(
    '/auth/mfa/verify',
    {
      onRequest: fastify.requireAuth,
      config: { allowPendingMfa: true, ...limits },
      schema: { tags: ['auth'], body: mfaCodeSchema, response: { 200: mfaVerifiedSchema } },
    },
    async (request, reply) => {
      const session = requireSession(request);
      if (session.mfa !== 'pending') throw fastify.httpErrors.forbidden('Код сейчас не требуется');
      const key = requireKey();
      await guardAttempts(session.userId);

      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        include: USER_INCLUDE,
      });
      if (!user?.totpEnabledAt || !user.totpSecret || user.bannedAt) {
        throw fastify.httpErrors.unauthorized('Сессия недействительна');
      }

      const code = request.body.code;
      let recoveryCodesLeft: number | null = null;

      if (looksLikeRecoveryCode(code)) {
        // Отметка условным обновлением: один код не сработает дважды, даже
        // если два запроса пришли одновременно.
        const used = await fastify.prisma.mfaRecoveryCode.updateMany({
          where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null },
          data: { usedAt: new Date() },
        });
        if (used.count === 0) return wrongCode(user.id);
        recoveryCodesLeft = await fastify.prisma.mfaRecoveryCode.count({
          where: { userId: user.id, usedAt: null },
        });
        request.log.warn({ userId: user.id, recoveryCodesLeft }, 'вход по резервному коду');
      } else {
        const secret = decryptSecret(user.totpSecret, key);
        if (!secret) {
          fastify.log.error({ userId: user.id }, 'секрет второго фактора не расшифровывается');
          throw fastify.httpErrors.serviceUnavailable('Второй фактор недоступен');
        }
        const step = verifyTotp(secret, code, { lastStep: user.totpLastStep });
        if (step === null) return wrongCode(user.id);
        // Шаг двигаем только вперёд и условно: параллельный запрос с тем же
        // кодом это условие уже не пройдёт.
        const moved = await fastify.prisma.user.updateMany({
          where: {
            id: user.id,
            OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
          },
          data: { totpLastStep: step },
        });
        if (moved.count === 0) return wrongCode(user.id);
      }

      await clearMfaFailures(fastify.redis, user.id);
      await fastify.replaceSession(request, reply, {
        userId: user.id,
        role: user.role,
        mfa: 'ok',
      });
      return { user: toCurrentUser(user, 'ok'), recoveryCodesLeft };
    },
  );
};
