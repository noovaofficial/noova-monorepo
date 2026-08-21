import {
  acknowledgedSchema,
  currentUserSchema,
  deleteAccountSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
  verifyEmailSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { MailQueue } from './mail-queue.js';
import { createMailer, localeOf, mailLink } from './mailer.js';
import { toCurrentUser } from './mappers.js';
import { burnTimeLikeVerify, hashPassword, verifyPassword } from './passwords.js';
import { emailTakenMail, resetPasswordMail, verifyEmailMail } from './templates.js';
import { EMAIL_TOKEN_TTL_MS, generateToken, hashToken, RESET_TOKEN_TTL_MS } from './tokens.js';

const ACK = { ok: true } as const;

export const authRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const mailer = createMailer(fastify.log);
  const mails = new MailQueue(fastify, mailer);
  mails.start();

  fastify.post(
    '/auth/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['auth'],
        body: registerSchema,
        response: { 200: acknowledgedSchema },
      },
    },
    async (request) => {
      const input = request.body;
      // Язык берём из заголовка браузера: интерфейс уже на нём, и письмо
      // должно прийти на том же. Пользователь его нигде не выбирает отдельно.
      const locale = localeOf(request.headers['accept-language']?.slice(0, 2));

      // Никнейм проверяем до создания: конфликт по нему безопасно показать,
      // он публичный и не раскрывает наличие учётки с данным email.
      if (input.role === 'client') {
        const taken = await fastify.prisma.clientProfile.findUnique({
          where: { nickname: input.nickname },
          select: { id: true },
        });
        if (taken) throw fastify.httpErrors.conflict('Никнейм занят');
      }

      const existing = await fastify.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true, locale: true },
      });

      // Занятый email не подтверждаем: ответ такой же, как при успехе.
      // Настоящему владельцу адреса уходит письмо о попытке регистрации.
      if (existing) {
        // Письмо уходит настоящему владельцу адреса, поэтому язык берём его,
        // а не того, кто сейчас заполнял форму.
        mails.enqueue({ to: input.email, ...emailTakenMail(localeOf(existing.locale)) });
        return ACK;
      }

      const passwordHash = await hashPassword(input.password);
      const { token, tokenHash } = generateToken();

      await fastify.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          role: input.role,
          locale,
          ...(input.role === 'advertiser' ? { advertiserKind: input.advertiserKind } : {}),
          ...(input.role === 'client'
            ? {
                clientProfile: {
                  create: {
                    nickname: input.nickname,
                    name: input.name ?? null,
                    birthYear: input.birthYear ?? null,
                    gender: input.gender ?? null,
                  },
                },
              }
            : {}),
          authTokens: {
            create: {
              tokenHash,
              purpose: 'email_verification',
              expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
            },
          },
        },
      });

      mails.enqueue({
        to: input.email,
        ...verifyEmailMail(locale, mailLink(locale, '/verify-email', token)),
      });

      return ACK;
    },
  );

  fastify.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        body: loginSchema,
        response: { 200: currentUserSchema },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await fastify.prisma.user.findUnique({
        where: { email },
        include: { clientProfile: true },
      });

      if (!user) {
        // Тратим то же время, что и на настоящую проверку: иначе по задержке
        // ответа можно перебирать существующие адреса.
        await burnTimeLikeVerify(password);
        throw fastify.httpErrors.unauthorized('Неверный email или пароль');
      }

      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) throw fastify.httpErrors.unauthorized('Неверный email или пароль');

      if (user.bannedAt) {
        await fastify.destroyAllSessions(user.id);
        // Причину показываем: человек должен понимать, за что, — иначе
        // единственный оставшийся ему шаг, письмо в поддержку, начинается
        // с вопроса «а что случилось».
        throw fastify.httpErrors.forbidden(
          user.banReason
            ? `Учётная запись заблокирована: ${user.banReason}`
            : 'Учётная запись заблокирована',
        );
      }

      await fastify.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await fastify.createSession(reply, { userId: user.id, role: user.role });
      return toCurrentUser(user);
    },
  );

  fastify.post(
    '/auth/logout',
    { schema: { tags: ['auth'], response: { 200: acknowledgedSchema } } },
    async (request, reply) => {
      await fastify.destroySession(request, reply);
      return ACK;
    },
  );

  fastify.post(
    '/auth/logout-all',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['auth'], response: { 200: acknowledgedSchema } },
    },
    async (request, reply) => {
      await fastify.destroyAllSessions(requireSession(request).userId);
      await fastify.destroySession(request, reply);
      return ACK;
    },
  );

  fastify.get(
    '/auth/me',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['auth'], response: { 200: currentUserSchema } },
    },
    async (request) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: requireSession(request).userId },
        include: { clientProfile: true },
      });
      if (!user) throw fastify.httpErrors.unauthorized('Сессия недействительна');
      return toCurrentUser(user);
    },
  );

  /**
   * Запрос на удаление учётной записи.
   *
   * Не мгновенное стирание: анкеты сразу уходят из каталога, но данные живут
   * ещё `ACCOUNT_DELETION_GRACE_DAYS`. Отсрочка не про удобство — удаление
   * необратимо, и с угнанной сессией без неё стирают чужой заработок,
   * который нечем восстановить. Пароль по той же причине обязателен.
   *
   * Сессии намеренно **не** гасим: отменить удаление можно только войдя,
   * и выкидывать человека сразу после запроса значит отнять эту возможность.
   */
  fastify.post(
    '/auth/delete-account',
    {
      onRequest: fastify.requireAuth,
      config: { rateLimit: { max: 5, timeWindow: '1 hour', allowList: () => false } },
      schema: { tags: ['auth'], body: deleteAccountSchema, response: { 200: currentUserSchema } },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        include: { clientProfile: true },
      });
      if (!user) throw fastify.httpErrors.unauthorized('Сессия недействительна');

      // Сотрудник не удаляет себя этой кнопкой: его учётку заводит и убирает
      // администратор, и самоудаление оставило бы раздел без модератора.
      if (user.role === 'moderator' || user.role === 'admin') {
        throw fastify.httpErrors.forbidden('Учётные записи сотрудников удаляет администратор');
      }

      const ok = await verifyPassword(user.passwordHash, request.body.password);
      if (!ok) throw fastify.httpErrors.unauthorized('Неверный пароль');

      const [updated] = await fastify.prisma.$transaction([
        fastify.prisma.user.update({
          where: { id: user.id },
          data: { deletionRequestedAt: new Date() },
          include: { clientProfile: true },
        }),
        // Из каталога анкеты уходят немедленно: обработка прекращается
        // сразу, а физическое удаление — вопрос срока.
        fastify.prisma.profile.updateMany({
          where: { ownerId: user.id, status: 'published' },
          data: { status: 'paused' },
        }),
      ]);

      const slugs = await fastify.prisma.profile.findMany({
        where: { ownerId: user.id },
        select: { slug: true },
      });
      fastify.revalidate([PROFILES_TAG, ...slugs.map((p) => profileTag(p.slug))]);

      return toCurrentUser(updated);
    },
  );

  fastify.post(
    '/auth/delete-account/cancel',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['auth'], response: { 200: currentUserSchema } },
    },
    async (request) => {
      const { userId } = requireSession(request);
      // Анкеты остаются приостановленными: вернуть их в каталог — отдельное
      // решение владелицы, а не побочный эффект отмены.
      const updated = await fastify.prisma.user.update({
        where: { id: userId },
        data: { deletionRequestedAt: null },
        include: { clientProfile: true },
      });
      return toCurrentUser(updated);
    },
  );

  fastify.post(
    '/auth/verify-email',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: { tags: ['auth'], body: verifyEmailSchema, response: { 200: acknowledgedSchema } },
    },
    async (request) => {
      const record = await fastify.prisma.authToken.findUnique({
        where: { tokenHash: hashToken(request.body.token) },
      });

      if (
        record?.purpose !== 'email_verification' ||
        record.usedAt ||
        record.expiresAt < new Date()
      ) {
        throw fastify.httpErrors.badRequest('Ссылка недействительна или устарела');
      }

      await fastify.prisma.$transaction([
        fastify.prisma.user.update({
          where: { id: record.userId },
          data: { emailVerifiedAt: new Date() },
        }),
        fastify.prisma.authToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
      ]);

      return ACK;
    },
  );

  fastify.post(
    '/auth/password-reset/request',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
      schema: {
        tags: ['auth'],
        body: passwordResetRequestSchema,
        response: { 200: acknowledgedSchema },
      },
    },
    async (request) => {
      const user = await fastify.prisma.user.findUnique({
        where: { email: request.body.email },
        select: { id: true, locale: true },
      });

      // Отсутствие учётки не подтверждаем — ответ одинаковый в обоих случаях.
      if (user) {
        const locale = localeOf(user.locale);
        const { token, tokenHash } = generateToken();
        await fastify.prisma.authToken.create({
          data: {
            userId: user.id,
            tokenHash,
            purpose: 'password_reset',
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });
        mails.enqueue({
          to: request.body.email,
          ...resetPasswordMail(locale, mailLink(locale, '/reset-password', token)),
        });
      }

      return ACK;
    },
  );

  fastify.post(
    '/auth/password-reset/confirm',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['auth'],
        body: passwordResetConfirmSchema,
        response: { 200: acknowledgedSchema },
      },
    },
    async (request) => {
      const record = await fastify.prisma.authToken.findUnique({
        where: { tokenHash: hashToken(request.body.token) },
      });

      if (record?.purpose !== 'password_reset' || record.usedAt || record.expiresAt < new Date()) {
        throw fastify.httpErrors.badRequest('Ссылка недействительна или устарела');
      }

      const passwordHash = await hashPassword(request.body.password);

      await fastify.prisma.$transaction([
        fastify.prisma.user.update({
          where: { id: record.userId },
          data: { passwordHash },
        }),
        fastify.prisma.authToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
      ]);

      // Смена пароля обесценивает все существующие сессии: если аккаунт увели,
      // сброс пароля должен выкинуть злоумышленника.
      await fastify.destroyAllSessions(record.userId);

      return ACK;
    },
  );

  fastify.get(
    '/auth/nickname-available',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        querystring: z.object({ nickname: z.string().min(2).max(24) }),
        response: { 200: z.object({ available: z.boolean() }) },
      },
    },
    async (request) => {
      const taken = await fastify.prisma.clientProfile.findUnique({
        where: { nickname: request.query.nickname },
        select: { id: true },
      });
      return { available: !taken };
    },
  );
};
