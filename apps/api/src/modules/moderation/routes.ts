import {
  blockedProfileSchema,
  blockSchema,
  isUrgentReason,
  managedUserSchema,
  moderatedProfileSchema,
  queueCountSchema,
  queueItemSchema,
  rejectionSchema,
  userSearchSchema,
} from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { localeQuerySchema, localized, translationSelect } from '../../i18n.js';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { approvePhoto, rejectPhoto } from '../photos/moderation.js';
import { getObject, isPublicKey, moderationPhotoUrl, publicUrl } from '../photos/storage.js';

const profileSelect = {
  id: true,
  slug: true,
  displayName: true,
  kind: true,
  ownerId: true,
  city: { select: { name: true } },
} as const;

/**
 * Модератор не проверяет собственные материалы. Роли разведены по разным
 * учётным записям, поэтому в норме это невозможно — но проверка остаётся:
 * без неё роль превращается в способ обойти модерацию.
 */
function refuseSelfModeration(fastify: FastifyInstance, ownerId: string, moderatorId: string) {
  if (ownerId === moderatorId) {
    throw fastify.httpErrors.forbidden('Нельзя модерировать собственные материалы');
  }
}

async function writeAction(
  fastify: FastifyInstance,
  moderatorId: string,
  subjectType: 'photo' | 'verification' | 'user' | 'comment' | 'profile',
  subjectId: string,
  decision: 'approved' | 'rejected',
  reason?: string,
) {
  await fastify.prisma.moderationAction.create({
    data: { moderatorId, subjectType, subjectId, decision, ...(reason ? { reason } : {}) },
  });
}

/** Поля пользователя для представления модератора. Один набор на четыре маршрута. */
const managedUserSelect = {
  id: true,
  email: true,
  role: true,
  emailVerifiedAt: true,
  bannedAt: true,
  banReason: true,
  createdAt: true,
  glowcoinBalance: true,
  clientProfile: { select: { nickname: true } },
  _count: { select: { profiles: true } },
} as const;

type ManagedUserRow = {
  id: string;
  email: string;
  role: 'client' | 'advertiser' | 'moderator' | 'admin';
  emailVerifiedAt: Date | null;
  bannedAt: Date | null;
  banReason: string | null;
  createdAt: Date;
  clientProfile: { nickname: string } | null;
  _count: { profiles: number };
  glowcoinBalance: number;
};

function toManagedUser(row: ManagedUserRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isEmailVerified: row.emailVerifiedAt !== null,
    isBlocked: row.bannedAt !== null,
    banReason: row.banReason,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    nickname: row.clientProfile?.nickname ?? null,
    profileCount: row._count.profiles,
    glowcoinBalance: row.glowcoinBalance,
    createdAt: row.createdAt.toISOString(),
  };
}

export const moderationRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Весь префикс закрыт ролью, а не спрятан в интерфейсе.
  const guard = fastify.requireRole('moderator', 'admin');

  /**
   * Файл фотографии для модератора. Он смотрит чужие анкеты, поэтому
   * владение не проверяется — достаточно роли. Одобренные сюда не ходят:
   * для них есть публичный префикс.
   */
  fastify.get(
    '/moderation/photos/:id/file',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ variant: z.enum(['thumb', 'card', 'full']).default('card') }),
      },
    },
    async (request, reply) => {
      const photo = await fastify.prisma.photo.findFirst({
        where: { id: request.params.id, deletedAt: null },
        select: { storageKey: true },
      });
      if (!photo) throw fastify.httpErrors.notFound('Фотография не найдена');

      const { body, contentType, contentLength } = await getObject(
        `${photo.storageKey}/${request.query.variant}.webp`,
      );
      reply.header('cache-control', 'private, max-age=300');
      reply.type(contentType);
      if (contentLength !== undefined) reply.header('content-length', contentLength);
      return reply.send(body);
    },
  );

  fastify.get(
    '/moderation/queue/count',
    {
      onRequest: guard,
      schema: { tags: ['moderation'], response: { 200: queueCountSchema } },
    },
    async () => {
      const [photos, verifications, pendingComments, openReports, profileReports, urgentReports] =
        await Promise.all([
          fastify.prisma.photo.count({ where: { isApproved: false, deletedAt: null } }),
          fastify.prisma.verificationCase.count({ where: { status: 'pending' } }),
          fastify.prisma.profileComment.count({ where: { status: 'pending' } }),
          // Жалоба на уже опубликованный комментарий — тоже работа модератора,
          // и в счётчике она должна быть видна: иначе жалобы копятся молча,
          // а владелице анкеты это единственный способ возразить.
          fastify.prisma.commentReport.count({
            where: { resolvedAt: null, comment: { status: 'published' } },
          }),
          fastify.prisma.profileReport.count({ where: { resolvedAt: null } }),
          // Срочные считаем отдельно: они должны быть видны в шапке как
          // отдельное число, а не растворяться в общем счётчике.
          fastify.prisma.profileReport.count({
            where: { resolvedAt: null, reason: { in: ['underage', 'coercion'] } },
          }),
        ]);
      const comments = pendingComments + openReports;
      return {
        photos,
        verifications,
        comments,
        reports: profileReports,
        urgentReports,
        total: photos + verifications + comments + profileReports,
      };
    },
  );

  fastify.get(
    '/moderation/queue',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        querystring: z.object({
          kind: z.enum(['photo', 'verification', 'comment', 'report']).optional(),
        }),
        response: { 200: z.array(queueItemSchema) },
      },
    },
    async (request) => {
      const wanted = request.query.kind;
      const items: z.infer<typeof queueItemSchema>[] = [];

      if (!wanted || wanted === 'verification') {
        const cases = await fastify.prisma.verificationCase.findMany({
          where: { status: 'pending' },
          orderBy: { submittedAt: 'asc' },
          take: 50,
          select: {
            id: true,
            submittedAt: true,
            ageConfirmed: true,
            identityConfirmed: true,
            profile: {
              select: {
                ...profileSelect,
                _count: { select: { photos: { where: { deletedAt: null } } } },
              },
            },
          },
        });

        for (const item of cases) {
          items.push({
            kind: 'verification',
            id: item.id,
            submittedAt: item.submittedAt?.toISOString() ?? null,
            ageConfirmed: item.ageConfirmed,
            identityConfirmed: item.identityConfirmed,
            photoCount: item.profile._count.photos,
            profile: {
              id: item.profile.id,
              slug: item.profile.slug,
              displayName: item.profile.displayName,
              kind: item.profile.kind,
              cityName: item.profile.city.name,
            },
          });
        }
      }

      if (!wanted || wanted === 'photo') {
        const photos = await fastify.prisma.photo.findMany({
          where: { isApproved: false, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          take: 50,
          select: {
            id: true,
            storageKey: true,
            width: true,
            height: true,
            createdAt: true,
            profile: { select: profileSelect },
          },
        });

        // Непроверенное фото не отдаётся публично даже модератору: файл
        // идёт через API, роль проверяется на каждый запрос.
        for (const photo of photos) {
          items.push({
            kind: 'photo',
            id: photo.id,
            url: moderationPhotoUrl(photo.id),
            width: photo.width,
            height: photo.height,
            createdAt: photo.createdAt.toISOString(),
            profile: {
              id: photo.profile.id,
              slug: photo.profile.slug,
              displayName: photo.profile.displayName,
              kind: photo.profile.kind,
              cityName: photo.profile.city.name,
            },
          });
        }
      }

      if (!wanted || wanted === 'comment') {
        const comments = await fastify.prisma.profileComment.findMany({
          // Новые на проверку и опубликованные, на которые пожаловались:
          // и то и другое — незакрытая работа модератора.
          where: {
            OR: [
              { status: 'pending' },
              { status: 'published', reports: { some: { resolvedAt: null } } },
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: 50,
          select: {
            id: true,
            body: true,
            status: true,
            createdAt: true,
            author: { select: { clientProfile: { select: { nickname: true } } } },
            profile: { select: { id: true, slug: true, displayName: true, city: true } },
            reports: {
              where: { resolvedAt: null },
              orderBy: { createdAt: 'asc' },
              select: { id: true, reason: true, createdAt: true },
            },
          },
        });

        for (const comment of comments) {
          items.push({
            kind: 'comment',
            id: comment.id,
            body: comment.body,
            status: comment.status,
            authorNickname: comment.author.clientProfile?.nickname ?? 'Гость',
            createdAt: comment.createdAt.toISOString(),
            profile: {
              id: comment.profile.id,
              slug: comment.profile.slug,
              displayName: comment.profile.displayName,
              cityName: comment.profile.city.name,
            },
            reports: comment.reports.map((report) => ({
              id: report.id,
              reason: report.reason,
              createdAt: report.createdAt.toISOString(),
            })),
          });
        }
      }

      if (!wanted || wanted === 'report') {
        const reports = await fastify.prisma.profileReport.findMany({
          where: { resolvedAt: null },
          // Срочные первыми, дальше по давности: жалоба на
          // несовершеннолетнюю не должна ждать за десятком сообщений о спаме.
          orderBy: [{ createdAt: 'asc' }],
          take: 100,
          select: {
            id: true,
            reason: true,
            details: true,
            createdAt: true,
            reporter: { select: { email: true } },
            profile: { select: { id: true, slug: true, displayName: true, city: true } },
          },
        });

        const openByProfile = new Map<string, number>();
        for (const report of reports) {
          openByProfile.set(report.profile.id, (openByProfile.get(report.profile.id) ?? 0) + 1);
        }

        const mapped = reports.map((report) => ({
          kind: 'report' as const,
          id: report.id,
          reason: report.reason,
          details: report.details,
          isUrgent: isUrgentReason(report.reason),
          reporterEmail: report.reporter?.email ?? null,
          createdAt: report.createdAt.toISOString(),
          profile: {
            id: report.profile.id,
            slug: report.profile.slug,
            displayName: report.profile.displayName,
            cityName: report.profile.city.name,
          },
          // Несколько независимых жалоб на одну анкету — сигнал сам по себе.
          otherOpenReports: (openByProfile.get(report.profile.id) ?? 1) - 1,
        }));

        mapped.sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent));
        items.push(...mapped);
      }

      return items;
    },
  );

  /**
   * Жалоба закрывается решением модератора и только им. Анкета при этом
   * не меняется: снятие — отдельное действие через просмотр анкеты.
   * Автоснятие по числу жалоб было бы инструментом травли конкурентами.
   */
  fastify.post(
    '/moderation/reports/:id/resolve',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        body: z.object({ note: z.string().trim().max(500).optional() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const report = await fastify.prisma.profileReport.findUnique({
        where: { id: request.params.id },
        select: { id: true, profileId: true, profile: { select: { ownerId: true } } },
      });
      if (!report) throw fastify.httpErrors.notFound('Жалоба не найдена');
      refuseSelfModeration(fastify, report.profile.ownerId, userId);

      await fastify.prisma.profileReport.update({
        where: { id: report.id },
        data: { resolvedAt: new Date() },
      });

      await writeAction(
        fastify,
        userId,
        'profile',
        report.profileId,
        'approved',
        request.body.note,
      );
      return { ok: true as const };
    },
  );

  /**
   * Одобрение комментария — это его публикация. Жалобы на него закрываются
   * тем же решением: модератор посмотрел и оставил, значит вопрос снят.
   */
  fastify.post(
    '/moderation/comments/:id/approve',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const comment = await fastify.prisma.profileComment.findUnique({
        where: { id: request.params.id },
        select: { id: true, profile: { select: { slug: true, ownerId: true } } },
      });
      if (!comment) throw fastify.httpErrors.notFound('Комментарий не найден');
      refuseSelfModeration(fastify, comment.profile.ownerId, userId);

      await fastify.prisma.$transaction([
        fastify.prisma.profileComment.update({
          where: { id: comment.id },
          data: { status: 'published', publishedAt: new Date(), moderationNote: null },
        }),
        fastify.prisma.commentReport.updateMany({
          where: { commentId: comment.id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        }),
      ]);

      await writeAction(fastify, userId, 'comment', comment.id, 'approved');
      // Комментарии видны на странице анкеты, а она кэшируется ISR:
      // без сброса тега решение модератора всплыло бы через десять минут.
      fastify.revalidate([profileTag(comment.profile.slug)]);
      return { ok: true as const };
    },
  );

  /**
   * Отказ снимает комментарий с публикации либо не пускает его туда.
   * Причина обязательна: автор должен понимать, почему его текст не вышел.
   */
  fastify.post(
    '/moderation/comments/:id/reject',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        body: rejectionSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const comment = await fastify.prisma.profileComment.findUnique({
        where: { id: request.params.id },
        select: { id: true, status: true, profile: { select: { slug: true, ownerId: true } } },
      });
      if (!comment) throw fastify.httpErrors.notFound('Комментарий не найден');
      refuseSelfModeration(fastify, comment.profile.ownerId, userId);

      // `hidden` для снятого с публикации, `rejected` для не прошедшего
      // проверку: снаружи разницы нет, но по журналу видно, был ли текст
      // когда-то виден людям.
      const status = comment.status === 'published' ? 'hidden' : 'rejected';

      await fastify.prisma.$transaction([
        fastify.prisma.profileComment.update({
          where: { id: comment.id },
          data: { status, publishedAt: null, moderationNote: request.body.reason },
        }),
        fastify.prisma.commentReport.updateMany({
          where: { commentId: comment.id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        }),
      ]);

      await writeAction(fastify, userId, 'comment', comment.id, 'rejected', request.body.reason);
      fastify.revalidate([profileTag(comment.profile.slug)]);
      return { ok: true as const };
    },
  );

  fastify.post(
    '/moderation/photos/:id/approve',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const photo = await fastify.prisma.photo.findUnique({
        where: { id: request.params.id },
        select: { id: true, deletedAt: true, profile: { select: { slug: true, ownerId: true } } },
      });
      if (!photo || photo.deletedAt) throw fastify.httpErrors.notFound('Фотография не найдена');
      refuseSelfModeration(fastify, photo.profile.ownerId, userId);

      await approvePhoto(fastify.prisma, photo.id);
      await writeAction(fastify, userId, 'photo', photo.id, 'approved');
      fastify.revalidate([profileTag(photo.profile.slug), PROFILES_TAG]);

      return { ok: true as const };
    },
  );

  fastify.post(
    '/moderation/photos/:id/reject',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        body: rejectionSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const photo = await fastify.prisma.photo.findUnique({
        where: { id: request.params.id },
        select: { id: true, deletedAt: true, profile: { select: { slug: true, ownerId: true } } },
      });
      if (!photo || photo.deletedAt) throw fastify.httpErrors.notFound('Фотография не найдена');
      refuseSelfModeration(fastify, photo.profile.ownerId, userId);

      await rejectPhoto(fastify.prisma, photo.id, request.body.reason);
      await writeAction(fastify, userId, 'photo', photo.id, 'rejected', request.body.reason);
      fastify.revalidate([profileTag(photo.profile.slug), PROFILES_TAG]);

      return { ok: true as const };
    },
  );

  fastify.post(
    '/moderation/verifications/:id/approve',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const item = await fastify.prisma.verificationCase.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          profileId: true,
          profile: { select: { slug: true, ownerId: true, status: true } },
        },
      });
      if (!item) throw fastify.httpErrors.notFound('Заявка не найдена');
      refuseSelfModeration(fastify, item.profile.ownerId, userId);

      const profileStatus = item.profile.status;

      await fastify.prisma.$transaction([
        fastify.prisma.verificationCase.update({
          where: { id: item.id },
          data: {
            status: 'verified',
            ageConfirmed: true,
            identityConfirmed: true,
            reviewedByUserId: userId,
            reviewedAt: new Date(),
            rejectionReason: null,
          },
        }),
        // Бейдж «Проверено» на карточке следует из этого флага.
        //
        // Статус анкеты тоже надо снять с «на проверке»: заявка одобрена,
        // и владелец должен видеть, что мяч на его стороне. Публикуем не мы —
        // решение остаётся за ним, поэтому возвращаем в черновик, а не
        // публикуем автоматически.
        fastify.prisma.profile.update({
          where: { id: item.profileId },
          data: {
            isVerified: true,
            moderationNote: null,
            ...(profileStatus === 'pending_verification' ? { status: 'draft' as const } : {}),
          },
        }),
      ]);

      await writeAction(fastify, userId, 'verification', item.id, 'approved');
      fastify.revalidate([profileTag(item.profile.slug), PROFILES_TAG]);

      return { ok: true as const };
    },
  );

  fastify.post(
    '/moderation/verifications/:id/reject',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        body: rejectionSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const item = await fastify.prisma.verificationCase.findUnique({
        where: { id: request.params.id },
        select: { id: true, profileId: true, profile: { select: { slug: true, ownerId: true } } },
      });
      if (!item) throw fastify.httpErrors.notFound('Заявка не найдена');
      refuseSelfModeration(fastify, item.profile.ownerId, userId);

      await fastify.prisma.$transaction([
        fastify.prisma.verificationCase.update({
          where: { id: item.id },
          data: {
            status: 'failed',
            reviewedByUserId: userId,
            reviewedAt: new Date(),
            rejectionReason: request.body.reason,
          },
        }),
        // Анкета возвращается владельцу на доработку с видимой причиной.
        fastify.prisma.profile.update({
          where: { id: item.profileId },
          data: { status: 'rejected', isVerified: false, moderationNote: request.body.reason },
        }),
      ]);

      await writeAction(fastify, userId, 'verification', item.id, 'rejected', request.body.reason);
      fastify.revalidate([profileTag(item.profile.slug), PROFILES_TAG]);

      return { ok: true as const };
    },
  );

  // ---------- Пользователи ----------

  /**
   * Блокировка анкеты — основная мера. Анкета уходит из каталога, но остаётся
   * у владелицы: она видит причину, правит и отправляет на проверку заново.
   * Учётная запись при этом не трогается — иначе исправить было бы нечем.
   */
  fastify.post(
    '/moderation/profiles/:id/block',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        body: blockSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const profile = await fastify.prisma.profile.findUnique({
        where: { id: request.params.id },
        select: { id: true, slug: true, ownerId: true },
      });
      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');
      refuseSelfModeration(fastify, profile.ownerId, userId);

      await fastify.prisma.$transaction([
        fastify.prisma.profile.update({
          where: { id: profile.id },
          data: { status: 'banned', moderationNote: request.body.reason },
        }),
        // Блокировка — это и есть разбор жалоб на неё.
        fastify.prisma.profileReport.updateMany({
          where: { profileId: profile.id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        }),
      ]);

      await writeAction(fastify, userId, 'profile', profile.id, 'rejected', request.body.reason);
      // Блокировка убирает анкету из каталога — сбрасываем и её страницу,
      // и листинги, иначе она провисит в кэше до истечения ISR.
      fastify.revalidate([profileTag(profile.slug), PROFILES_TAG]);
      return { ok: true as const };
    },
  );

  /**
   * Снятие блокировки возвращает анкету в «приостановлено», а не в
   * «опубликовано»: модератор снимает запрет, но решение показывать анкету
   * снова принимает владелица. Иначе снятие молча вернуло бы в каталог
   * содержимое, которое она, возможно, уже сама решила не публиковать.
   */
  fastify.post(
    '/moderation/profiles/:id/unblock',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const profile = await fastify.prisma.profile.findUnique({
        where: { id: request.params.id },
        select: { id: true, slug: true, status: true, ownerId: true },
      });
      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');
      if (profile.status !== 'banned') {
        throw fastify.httpErrors.conflict('Анкета не заблокирована');
      }

      await fastify.prisma.profile.update({
        where: { id: profile.id },
        data: { status: 'paused', moderationNote: null },
      });

      await writeAction(fastify, userId, 'profile', profile.id, 'approved', 'Блокировка снята');
      // Блокировка убирает анкету из каталога — сбрасываем и её страницу,
      // и листинги, иначе она провисит в кэше до истечения ISR.
      fastify.revalidate([profileTag(profile.slug), PROFILES_TAG]);
      return { ok: true as const };
    },
  );

  /**
   * Блокировка учётной записи — крайняя мера: человек перестаёт входить,
   * а значит не может ни увидеть подробностей, ни что-либо исправить.
   * Причину он видит на форме входа.
   */
  fastify.post(
    '/moderation/users/:id/block',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        body: blockSchema,
        response: { 200: managedUserSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      if (request.params.id === userId) {
        throw fastify.httpErrors.badRequest('Нельзя заблокировать собственную учётную запись');
      }

      const target = await fastify.prisma.user.findUnique({
        where: { id: request.params.id },
        select: { id: true, role: true },
      });
      if (!target) throw fastify.httpErrors.notFound('Пользователь не найден');
      // Сотрудниками распоряжается админ через /admin/staff: коллеги —
      // не предмет модерации.
      if (target.role === 'moderator' || target.role === 'admin') {
        throw fastify.httpErrors.forbidden('Сотрудников блокирует администратор');
      }

      const updated = await fastify.prisma.user.update({
        where: { id: target.id },
        data: { bannedAt: new Date(), banReason: request.body.reason },
        select: managedUserSelect,
      });

      // Блокировка должна действовать сразу, а не после истечения куки.
      await fastify.destroyAllSessions(target.id);
      await writeAction(fastify, userId, 'user', target.id, 'rejected', request.body.reason);
      return toManagedUser(updated);
    },
  );

  fastify.post(
    '/moderation/users/:id/unblock',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: managedUserSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const target = await fastify.prisma.user.findUnique({
        where: { id: request.params.id },
        select: { id: true, bannedAt: true },
      });
      if (!target) throw fastify.httpErrors.notFound('Пользователь не найден');
      if (!target.bannedAt) throw fastify.httpErrors.conflict('Учётная запись не заблокирована');

      const updated = await fastify.prisma.user.update({
        where: { id: target.id },
        data: { bannedAt: null, banReason: null },
        select: managedUserSelect,
      });

      await writeAction(fastify, userId, 'user', target.id, 'approved', 'Блокировка снята');
      return toManagedUser(updated);
    },
  );

  /**
   * Заблокированные анкеты списком. Не фильтр в очереди: очередь — это то,
   * что ждёт решения, а здесь решения уже приняты, и смотрят сюда с другой
   * целью — вспомнить, за что заблокировали, и при необходимости снять.
   *
   * Видно и модератору: он же и блокирует, а список без возможности найти
   * собственное решение бесполезен.
   */
  fastify.get(
    '/moderation/blocked-profiles',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
        response: { 200: z.array(blockedProfileSchema) },
      },
    },
    async (request) => {
      const rows = await fastify.prisma.profile.findMany({
        where: { status: 'banned' },
        // По свежести блокировки: `updatedAt` меняется в момент решения.
        orderBy: { updatedAt: 'desc' },
        take: request.query.limit,
        select: {
          id: true,
          slug: true,
          displayName: true,
          kind: true,
          moderationNote: true,
          updatedAt: true,
          city: { select: { name: true } },
          owner: { select: { email: true, bannedAt: true } },
        },
      });

      // Кто и когда заблокировал — в журнале решений; берём последнюю запись
      // по каждой анкете, чтобы показать дату отдельно от `updatedAt`,
      // который меняется и от правок владелицы.
      const actions = await fastify.prisma.moderationAction.findMany({
        where: {
          subjectType: 'profile',
          subjectId: { in: rows.map((row) => row.id) },
          decision: 'rejected',
        },
        orderBy: { createdAt: 'desc' },
        select: { subjectId: true, createdAt: true },
      });
      const blockedAt = new Map<string, Date>();
      for (const action of actions) {
        if (!blockedAt.has(action.subjectId)) blockedAt.set(action.subjectId, action.createdAt);
      }

      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        displayName: row.displayName,
        cityName: row.city.name,
        kind: row.kind,
        reason: row.moderationNote,
        ownerEmail: row.owner.email,
        // Блокировка анкеты и блокировка учётной записи — разные меры;
        // видеть их вместе нужно, чтобы не принять одну за другую.
        isOwnerBlocked: row.owner.bannedAt !== null,
        blockedAt: blockedAt.get(row.id)?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
  );

  fastify.get(
    '/moderation/users',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        querystring: userSearchSchema,
        response: { 200: z.array(managedUserSchema) },
      },
    },
    async (request) => {
      const { query, limit } = request.query;

      const rows = await fastify.prisma.user.findMany({
        where: {
          ...(query ? { email: { contains: query, mode: 'insensitive' } } : {}),
          ...(request.query.blocked === 'true' ? { bannedAt: { not: null } } : {}),
          ...(request.query.role ? { role: request.query.role } : {}),
        },
        // Заблокированных показываем по свежести блокировки, остальных — по
        // дате регистрации: в таблице блокировок интересны последние решения.
        orderBy: request.query.blocked === 'true' ? { bannedAt: 'desc' } : { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          bannedAt: true,
          banReason: true,
          createdAt: true,
          glowcoinBalance: true,
          clientProfile: { select: { nickname: true } },
          _count: { select: { profiles: true } },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        isEmailVerified: row.emailVerifiedAt !== null,
        isBlocked: row.bannedAt !== null,
        banReason: row.banReason,
        bannedAt: row.bannedAt?.toISOString() ?? null,
        nickname: row.clientProfile?.nickname ?? null,
        profileCount: row._count.profiles,
        glowcoinBalance: row.glowcoinBalance,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  );

  fastify.post(
    '/moderation/users/:id/verify-email',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: managedUserSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);

      const target = await fastify.prisma.user.findUnique({
        where: { id: request.params.id },
        select: { id: true, emailVerifiedAt: true },
      });
      if (!target) throw fastify.httpErrors.notFound('Пользователь не найден');
      if (target.emailVerifiedAt) {
        throw fastify.httpErrors.conflict('Адрес уже подтверждён');
      }

      const updated = await fastify.prisma.user.update({
        where: { id: target.id },
        data: { emailVerifiedAt: new Date() },
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          bannedAt: true,
          banReason: true,
          createdAt: true,
          glowcoinBalance: true,
          clientProfile: { select: { nickname: true } },
          _count: { select: { profiles: true } },
        },
      });

      // Ручное подтверждение обходит доказательство владения адресом: сотрудник
      // ручается за пользователя вместо письма. Поэтому оно обязательно
      // попадает в журнал — иначе не выяснить, кто и за кого поручился.
      await writeAction(
        fastify,
        userId,
        'user',
        target.id,
        'approved',
        'Подтверждение адреса вручную',
      );

      return {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        isEmailVerified: updated.emailVerifiedAt !== null,
        isBlocked: updated.bannedAt !== null,
        banReason: updated.banReason,
        bannedAt: updated.bannedAt?.toISOString() ?? null,
        nickname: updated.clientProfile?.nickname ?? null,
        profileCount: updated._count.profiles,
        glowcoinBalance: updated.glowcoinBalance,
        createdAt: updated.createdAt.toISOString(),
      };
    },
  );

  fastify.get(
    '/moderation/profiles/:id',
    {
      onRequest: guard,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        querystring: localeQuerySchema,
        response: { 200: moderatedProfileSchema },
      },
    },
    async (request) => {
      const { locale } = request.query;
      // Публичный маршрут отдаёт только опубликованные анкеты, поэтому
      // модератору нужен свой: проверять он должен именно то, что ещё
      // не опубликовано.
      const profile = await fastify.prisma.profile.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          slug: true,
          status: true,
          kind: true,
          displayName: true,
          description: true,
          age: true,
          heightCm: true,
          weightKg: true,
          languages: true,
          createdAt: true,
          city: { select: { name: true } },
          district: { select: { name: true } },
          owner: { select: { email: true, advertiserKind: true } },
          prices: {
            orderBy: { durationMinutes: 'asc' },
            select: { durationMinutes: true, incallCents: true, outcallCents: true },
          },
          services: {
            where: { service: { isActive: true } },
            select: {
              service: { select: { key: true, translations: translationSelect(locale) } },
            },
          },
          photos: {
            where: { deletedAt: null },
            orderBy: { position: 'asc' },
            select: {
              id: true,
              storageKey: true,
              isApproved: true,
              rejectedReason: true,
            },
          },
          verification: { select: { status: true } },
        },
      });

      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');

      return {
        id: profile.id,
        slug: profile.slug,
        status: profile.status,
        kind: profile.kind,
        displayName: profile.displayName,
        description: profile.description,
        cityName: profile.city.name,
        districtName: profile.district?.name ?? null,
        age: profile.age,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        languages: profile.languages,
        services: profile.services.map((s) => ({
          key: s.service.key,
          name: localized(s.service.translations, s.service.key),
        })),
        prices: profile.prices,
        photos: await Promise.all(
          profile.photos.map(async (photo) => ({
            id: photo.id,
            // Одобренное лежит в публичном префиксе, остальное идёт через API.
            url: isPublicKey(photo.storageKey)
              ? publicUrl(`${photo.storageKey}/card.webp`)
              : moderationPhotoUrl(photo.id),
            isApproved: photo.isApproved,
            rejectedReason: photo.rejectedReason,
          })),
        ),
        verificationStatus: profile.verification?.status ?? 'none',
        owner: {
          email: profile.owner.email,
          advertiserKind: profile.owner.advertiserKind,
        },
        createdAt: profile.createdAt.toISOString(),
      };
    },
  );
};
