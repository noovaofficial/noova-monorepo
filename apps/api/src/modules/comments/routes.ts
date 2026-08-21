import {
  COMMENT_COOLDOWN_HOURS,
  createCommentSchema,
  ownCommentSchema,
  profileCommentSchema,
  reportCommentSchema,
  slugSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSession } from '../../plugins/session.js';

/** Подпись автора наружу. Учётка без никнейма не должна выглядеть пустой. */
const ANONYMOUS = 'Гость';

export const commentRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/profiles/:slug/comments',
    {
      schema: {
        tags: ['comments'],
        params: z.object({ slug: slugSchema }),
        response: { 200: z.array(profileCommentSchema) },
      },
    },
    async (request) => {
      const rows = await fastify.prisma.profileComment.findMany({
        // Только опубликованные. Ни `pending`, ни `rejected`, ни `hidden`
        // сюда не попадают ни при каких условиях: этот ответ кэшируется
        // страницей анкеты и виден всем.
        where: {
          status: 'published',
          profile: { slug: request.params.slug, status: 'published' },
        },
        orderBy: { publishedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { clientProfile: { select: { nickname: true } } } },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        body: row.body,
        authorNickname: row.author.clientProfile?.nickname ?? ANONYMOUS,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  );

  fastify.get(
    '/profiles/:slug/comments/mine',
    {
      onRequest: fastify.requireRole('client'),
      schema: {
        tags: ['comments'],
        params: z.object({ slug: slugSchema }),
        response: { 200: ownCommentSchema.nullable() },
      },
    },
    async (request) => {
      const row = await fastify.prisma.profileComment.findFirst({
        where: {
          authorId: requireSession(request).userId,
          profile: { slug: request.params.slug },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          body: true,
          status: true,
          moderationNote: true,
          createdAt: true,
        },
      });

      if (!row) return null;
      return { ...row, createdAt: row.createdAt.toISOString() };
    },
  );

  fastify.post(
    '/profiles/:slug/comments',
    {
      onRequest: fastify.requireRole('client'),
      config: { rateLimit: { max: 10, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['comments'],
        params: z.object({ slug: slugSchema }),
        body: createCommentSchema,
        response: { 201: ownCommentSchema },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      });
      // Подтверждённая почта — минимальная цена за возможность высказаться
      // о живом человеке: иначе анонимная травля стоит одной регистрации.
      if (!user?.emailVerifiedAt) {
        throw fastify.httpErrors.forbidden('Сначала подтвердите адрес электронной почты');
      }

      const profile = await fastify.prisma.profile.findFirst({
        where: { slug: request.params.slug, status: 'published' },
        select: { id: true, ownerId: true },
      });
      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');

      // Роль уже отсечена, но проверка остаётся: учётка может быть и той,
      // и другой стороной, а комментарий себе — это накрутка.
      if (profile.ownerId === userId) {
        throw fastify.httpErrors.forbidden('Нельзя комментировать собственную анкету');
      }

      const since = new Date(Date.now() - COMMENT_COOLDOWN_HOURS * 60 * 60 * 1000);
      const recent = await fastify.prisma.profileComment.count({
        where: { authorId: userId, profileId: profile.id, createdAt: { gte: since } },
      });
      // Не общий лимит запросов, а продуктовое правило: один человек —
      // один отзыв в сутки на анкету, иначе страница превращается в ленту
      // одного автора.
      if (recent > 0) {
        throw fastify.httpErrors.conflict('Комментарий к этой анкете уже оставлен сегодня');
      }

      const created = await fastify.prisma.profileComment.create({
        // status по умолчанию `pending`: премодерация не опция, а требование.
        data: { profileId: profile.id, authorId: userId, body: request.body.body },
        select: { id: true, body: true, status: true, moderationNote: true, createdAt: true },
      });

      return reply.status(201).send({ ...created, createdAt: created.createdAt.toISOString() });
    },
  );

  fastify.post(
    '/comments/:id/report',
    {
      onRequest: fastify.requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['comments'],
        params: z.object({ id: z.string().min(1) }),
        body: reportCommentSchema,
        response: { 201: z.object({ id: z.string() }) },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);

      const comment = await fastify.prisma.profileComment.findUnique({
        where: { id: request.params.id },
        select: { id: true, authorId: true, status: true },
      });
      if (!comment) throw fastify.httpErrors.notFound('Комментарий не найден');

      // На собственный комментарий жалуются удалением, а не жалобой.
      if (comment.authorId === userId) {
        throw fastify.httpErrors.forbidden('Нельзя пожаловаться на собственный комментарий');
      }

      try {
        const report = await fastify.prisma.commentReport.create({
          data: { commentId: comment.id, reporterId: userId, reason: request.body.reason },
          select: { id: true },
        });
        return reply.status(201).send(report);
      } catch {
        // Уникальность пары «комментарий + заявитель» — единственная причина
        // конфликта здесь, и она означает «жалоба уже подана», а не сбой.
        throw fastify.httpErrors.conflict('Жалоба на этот комментарий уже подана');
      }
    },
  );
};
