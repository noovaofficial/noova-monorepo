import {
  managedUserDetailSchema,
  ownVerificationSchema,
  pageSchema,
  rejectionSchema,
  VERIFICATION_PHOTO_KINDS,
  type VerificationPhotoKind,
  verificationPhotoKindSchema,
  verificationRequestDetailSchema,
  verificationRequestSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { ImageError, MAX_UPLOAD_BYTES, processImage } from '../photos/images.js';
import { decodeCursor, encodeCursor } from '../profiles/query.js';
import {
  deleteVerificationPhotos,
  putVerificationPhoto,
  readVerificationPhoto,
  toVerificationDetail,
  toVerificationItem,
  verificationSelect,
} from './service.js';

/**
 * Верификация личности (D-12).
 *
 * Отдельно от проверки анкеты: та решает, попадёт ли анкета в каталог, эта —
 * получит ли она бейдж «Проверено». Публикацию верификация не открывает и
 * не закрывает.
 *
 * Снимки документов — данные особой категории: в базе только ключи, файлы
 * в приватном префиксе хранилища, наружу их отдаёт единственный маршрут,
 * закрытый ролью персонала.
 */
export const verificationRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const staff = fastify.requireRole('moderator', 'admin');

  // ---------- Владелица анкеты ----------

  fastify.get(
    '/me/profiles/:id/verification',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: ownVerificationSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const found = await fastify.prisma.verificationRequest.findFirst({
        where: { profileId: request.params.id, profile: { ownerId: userId } },
        orderBy: { submittedAt: 'desc' },
        select: {
          status: true,
          submittedAt: true,
          reviewedAt: true,
          rejectionReason: true,
        },
      });

      // Заявок не было — это не ошибка, а исходное состояние.
      if (!found) {
        return { status: null, submittedAt: null, reviewedAt: null, rejectionReason: null };
      }
      return {
        status: found.status,
        submittedAt: found.submittedAt.toISOString(),
        reviewedAt: found.reviewedAt?.toISOString() ?? null,
        rejectionReason: found.rejectionReason,
      };
    },
  );

  /**
   * Подача заявки: три снимка одним запросом. Частичная заявка бессмысленна —
   * по одному лицу без документа решение не принять, — поэтому либо все три,
   * либо отказ.
   */
  fastify.post(
    '/me/profiles/:id/verification',
    {
      onRequest: fastify.requireAuth,
      // Заявка тяжёлая: три снимка и обработка. Лимит ниже фотографического.
      config: { rateLimit: { max: 10, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        response: { 201: ownVerificationSchema },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const profile = await fastify.prisma.profile.findFirst({
        where: { id: request.params.id, ownerId: userId },
        select: { id: true, status: true },
      });
      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');
      // «При активной анкете»: верификация подтверждает того, кто уже
      // размещается, а не того, кто когда-нибудь соберётся.
      if (profile.status !== 'published') {
        throw fastify.httpErrors.conflict('Верификация доступна опубликованной анкете');
      }

      const last = await fastify.prisma.verificationRequest.findFirst({
        where: { profileId: profile.id },
        orderBy: { submittedAt: 'desc' },
        select: { status: true },
      });
      if (last?.status === 'pending') {
        throw fastify.httpErrors.conflict('Заявка уже на рассмотрении');
      }
      if (last?.status === 'approved') {
        throw fastify.httpErrors.conflict('Верификация уже пройдена');
      }

      // Лимит на файлы поднимаем только здесь: общий стоит на одном файле
      // ради загрузки фотографий анкеты.
      const buffers = new Map<VerificationPhotoKind, Buffer>();
      const parts = request.parts({ limits: { files: 3, fileSize: MAX_UPLOAD_BYTES } });
      try {
        for await (const part of parts) {
          if (part.type !== 'file') continue;
          const kind = VERIFICATION_PHOTO_KINDS.find((name) => name === part.fieldname);
          // Поток дочитываем в любом случае: брошенная часть подвешивает разбор.
          const buffer = await part.toBuffer();
          if (kind) buffers.set(kind, buffer);
        }
      } catch {
        throw fastify.httpErrors.badRequest('Файл больше допустимого размера');
      }

      const missing = VERIFICATION_PHOTO_KINDS.filter((kind) => !buffers.has(kind));
      if (missing.length > 0) {
        throw fastify.httpErrors.badRequest(`Не хватает снимков: ${missing.join(', ')}`);
      }

      // Обработка не только уменьшает вес: она снимает метаданные, включая
      // координаты съёмки, — их в документе быть не должно.
      const processed = new Map<VerificationPhotoKind, Buffer>();
      for (const [kind, buffer] of buffers) {
        try {
          const image = await processImage(buffer);
          processed.set(kind, image.variants.full.buffer);
        } catch (error) {
          if (error instanceof ImageError) {
            throw fastify.httpErrors.badRequest('Один из файлов не является изображением');
          }
          throw error;
        }
      }

      // Запись создаём до загрузки: её id входит в ключи объектов.
      const created = await fastify.prisma.verificationRequest.create({
        data: { profileId: profile.id, faceKey: '', documentKey: '', togetherKey: '' },
        select: { id: true },
      });

      try {
        const keys = await Promise.all(
          VERIFICATION_PHOTO_KINDS.map(async (kind) => {
            const key = await putVerificationPhoto(created.id, kind, processed.get(kind) as Buffer);
            return [kind, key] as const;
          }),
        );
        const byKind = new Map(keys);
        const saved = await fastify.prisma.verificationRequest.update({
          where: { id: created.id },
          data: {
            faceKey: byKind.get('face') as string,
            documentKey: byKind.get('document') as string,
            togetherKey: byKind.get('together') as string,
          },
          select: { status: true, submittedAt: true },
        });

        return reply.status(201).send({
          status: saved.status,
          submittedAt: saved.submittedAt.toISOString(),
          reviewedAt: null,
          rejectionReason: null,
        });
      } catch (error) {
        // Хранилище недоступно — не оставляем заявку, ссылающуюся в пустоту.
        await deleteVerificationPhotos(created.id).catch(() => undefined);
        await fastify.prisma.verificationRequest.delete({ where: { id: created.id } });
        throw error;
      }
    },
  );

  // ---------- Модерация ----------

  fastify.get(
    '/moderation/identity',
    {
      onRequest: staff,
      schema: {
        tags: ['moderation'],
        querystring: z.object({
          status: z.enum(['pending', 'approved', 'rejected']).optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
        response: { 200: pageSchema(verificationRequestSchema) },
      },
    },
    async (request) => {
      const { limit } = request.query;
      const cursorId = decodeCursor(request.query.cursor);
      // Пусто — ждущие решения: за этим на экран и приходят.
      const where = { status: request.query.status ?? ('pending' as const) };

      const fetched = await fastify.prisma.verificationRequest.findMany({
        where,
        // Старые первыми: заявка, поданная раньше, ждать дольше не должна.
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: verificationSelect,
      });

      const hasMore = fetched.length > limit;
      const rows = fetched.slice(0, limit);
      return {
        items: rows.map(toVerificationItem),
        nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]?.id ?? '') : null,
        total: await fastify.prisma.verificationRequest.count({ where }),
      };
    },
  );

  fastify.get(
    '/moderation/identity/:id',
    {
      onRequest: staff,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: verificationRequestDetailSchema },
      },
    },
    async (request) => {
      const found = await fastify.prisma.verificationRequest.findUnique({
        where: { id: request.params.id },
        select: verificationSelect,
      });
      if (!found) throw fastify.httpErrors.notFound('Заявка не найдена');
      return toVerificationDetail(found);
    },
  );

  /**
   * Байты снимка. Единственный путь к документу: бакет его анонимно не
   * отдаёт, ссылки не существует, роль проверяется на каждый запрос.
   */
  fastify.get(
    '/moderation/identity/:id/photo/:kind',
    {
      onRequest: staff,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1), kind: verificationPhotoKindSchema }),
      },
    },
    async (request, reply) => {
      const found = await fastify.prisma.verificationRequest.findUnique({
        where: { id: request.params.id },
        select: { faceKey: true, documentKey: true, togetherKey: true, purgedAt: true },
      });
      if (!found || found.purgedAt) throw fastify.httpErrors.notFound('Снимок недоступен');

      const key = {
        face: found.faceKey,
        document: found.documentKey,
        together: found.togetherKey,
      }[request.params.kind];
      if (!key) throw fastify.httpErrors.notFound('Снимок недоступен');

      const { body, contentType, contentLength } = await readVerificationPhoto(key);
      // no-store, а не private: документ не должен осесть даже в кэше браузера
      // модератора — с общей машины его увидел бы следующий смотрящий.
      reply.header('cache-control', 'no-store');
      reply.header('cross-origin-resource-policy', 'same-site');
      reply.type(contentType);
      if (contentLength !== undefined) reply.header('content-length', contentLength);
      return reply.send(body);
    },
  );

  fastify.post(
    '/moderation/identity/:id/approve',
    {
      onRequest: staff,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: verificationRequestDetailSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const found = await fastify.prisma.verificationRequest.findUnique({
        where: { id: request.params.id },
        select: { id: true, status: true, profileId: true, profile: { select: { slug: true } } },
      });
      if (!found) throw fastify.httpErrors.notFound('Заявка не найдена');
      if (found.status !== 'pending') throw fastify.httpErrors.conflict('Заявка уже рассмотрена');

      const [, updated] = await fastify.prisma.$transaction([
        fastify.prisma.profile.update({
          where: { id: found.profileId },
          data: { isVerified: true },
        }),
        fastify.prisma.verificationRequest.update({
          where: { id: found.id },
          data: {
            status: 'approved',
            reviewedAt: new Date(),
            reviewedByUserId: userId,
            rejectionReason: null,
          },
          select: verificationSelect,
        }),
      ]);

      await fastify.prisma.moderationAction.create({
        data: {
          moderatorId: userId,
          subjectType: 'identity',
          subjectId: found.id,
          decision: 'approved',
        },
      });
      // Бейдж виден в каталоге и на странице анкеты.
      fastify.revalidate([PROFILES_TAG, profileTag(found.profile.slug)]);
      return toVerificationDetail(updated);
    },
  );

  fastify.post(
    '/moderation/identity/:id/reject',
    {
      onRequest: staff,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        body: rejectionSchema,
        response: { 200: verificationRequestDetailSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const found = await fastify.prisma.verificationRequest.findUnique({
        where: { id: request.params.id },
        select: { id: true, status: true },
      });
      if (!found) throw fastify.httpErrors.notFound('Заявка не найдена');
      if (found.status !== 'pending') throw fastify.httpErrors.conflict('Заявка уже рассмотрена');

      // Бейдж не трогаем: отказ по новой заявке не отменяет прошлое решение,
      // а снять его — отдельное действие модератора над анкетой.
      const updated = await fastify.prisma.verificationRequest.update({
        where: { id: found.id },
        data: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedByUserId: userId,
          rejectionReason: request.body.reason,
        },
        select: verificationSelect,
      });

      await fastify.prisma.moderationAction.create({
        data: {
          moderatorId: userId,
          subjectType: 'identity',
          subjectId: found.id,
          decision: 'rejected',
          reason: request.body.reason,
        },
      });
      return toVerificationDetail(updated);
    },
  );

  // ---------- Пользователь целиком ----------

  /**
   * Страница пользователя в модерации: тип, подписка, баланс, анкеты.
   * Список отвечает на вопрос «кто это», страница — «что у него».
   */
  fastify.get(
    '/moderation/users/:id',
    {
      onRequest: staff,
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: managedUserDetailSchema },
      },
    },
    async (request) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          bannedAt: true,
          banReason: true,
          createdAt: true,
          lastLoginAt: true,
          locale: true,
          advertiserKind: true,
          deletionRequestedAt: true,
          glowcoinBalance: true,
          clientProfile: { select: { nickname: true } },
          _count: { select: { profiles: true } },
          listings: {
            where: { status: { not: 'expired' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, kind: true, term: true, expiresAt: true },
          },
          profiles: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              slug: true,
              displayName: true,
              status: true,
              isVerified: true,
              isFeatured: true,
              city: { select: { name: true } },
            },
          },
        },
      });
      if (!user) throw fastify.httpErrors.notFound('Пользователь не найден');

      const listing = user.listings[0] ?? null;
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        isEmailVerified: user.emailVerifiedAt !== null,
        isBlocked: user.bannedAt !== null,
        banReason: user.banReason,
        bannedAt: user.bannedAt?.toISOString() ?? null,
        nickname: user.clientProfile?.nickname ?? null,
        profileCount: user._count.profiles,
        glowcoinBalance: user.glowcoinBalance,
        createdAt: user.createdAt.toISOString(),
        advertiserKind: user.advertiserKind,
        locale: user.locale,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
        subscription: listing
          ? {
              status: listing.status,
              kind: listing.kind,
              term: listing.term,
              expiresAt: listing.expiresAt.toISOString(),
            }
          : null,
        profiles: user.profiles.map((profile) => ({
          id: profile.id,
          slug: profile.slug,
          displayName: profile.displayName,
          status: profile.status,
          cityName: profile.city.name,
          isVerified: profile.isVerified,
          isFeatured: profile.isFeatured,
        })),
      };
    },
  );
};
