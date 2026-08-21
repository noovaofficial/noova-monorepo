import { ownPhotoSchema, photoOrderSchema } from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { ImageError, MAX_PHOTOS_PER_PROFILE, MAX_UPLOAD_BYTES, processImage } from './images.js';
import {
  deleteObject,
  isPublicKey,
  PENDING_PREFIX,
  publicUrl,
  putObject,
  signedUrl,
} from './storage.js';

async function ownedProfileOr404(fastify: FastifyInstance, userId: string, profileId: string) {
  const profile = await fastify.prisma.profile.findFirst({
    where: { id: profileId, ownerId: userId },
    select: { id: true, slug: true },
  });
  if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');
  return profile;
}

type PhotoRow = {
  id: string;
  storageKey: string;
  width: number;
  height: number;
  blurDataUrl: string | null;
  position: number;
  isApproved: boolean;
  rejectedReason: string | null;
};

/**
 * Ссылка зависит от того, одобрено ли фото: одобренное лежит в публичном
 * префиксе и отдаётся напрямую, неодобренное — только по подписанной ссылке
 * на несколько минут.
 */
async function toOwnPhoto(row: PhotoRow) {
  const cardKey = `${row.storageKey}/card.webp`;
  return {
    id: row.id,
    url: isPublicKey(row.storageKey) ? publicUrl(cardKey) : await signedUrl(cardKey),
    blurDataUrl: row.blurDataUrl,
    width: row.width,
    height: row.height,
    position: row.position,
    isApproved: row.isApproved,
    rejectedReason: row.rejectedReason,
  };
}

export const photoRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/me/profiles/:id/photos',
    {
      onRequest: fastify.requireAuth,
      config: { rateLimit: { max: 40, timeWindow: '1 hour' } },
      schema: {
        tags: ['photos'],
        params: z.object({ id: z.string().min(1) }),
        response: { 201: ownPhotoSchema },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!file) throw fastify.httpErrors.badRequest('Файл не передан');

      const buffer = await file.toBuffer().catch(() => {
        throw fastify.httpErrors.badRequest('Файл больше допустимого размера');
      });

      const count = await fastify.prisma.photo.count({
        where: { profileId: request.params.id, deletedAt: null },
      });
      if (count >= MAX_PHOTOS_PER_PROFILE) {
        throw fastify.httpErrors.conflict('Достигнут лимит фотографий');
      }

      let processed: Awaited<ReturnType<typeof processImage>>;
      try {
        processed = await processImage(buffer);
      } catch (error) {
        if (error instanceof ImageError) {
          throw fastify.httpErrors.badRequest(
            'Файл не является изображением поддерживаемого формата',
          );
        }
        throw error;
      }

      // Запись создаём до загрузки в хранилище: её id входит в ключ объекта,
      // и без него некуда класть файлы.
      const photo = await fastify.prisma.photo.create({
        data: {
          profileId: request.params.id,
          storageKey: '',
          width: processed.width,
          height: processed.height,
          blurDataUrl: processed.blurDataUrl,
          position: count,
          mimeType: 'image/webp',
          bytes: buffer.byteLength,
          isApproved: false,
        },
        select: { id: true },
      });

      const storageKey = `${PENDING_PREFIX}/${request.params.id}/${photo.id}`;

      try {
        await Promise.all(
          Object.entries(processed.variants).map(([name, variant]) =>
            putObject(`${storageKey}/${name}.webp`, variant.buffer, 'image/webp'),
          ),
        );
      } catch (error) {
        // Хранилище недоступно — не оставляем запись, которая ссылается
        // на несуществующие файлы.
        await fastify.prisma.photo.delete({ where: { id: photo.id } });
        throw error;
      }

      const saved = await fastify.prisma.photo.update({
        where: { id: photo.id },
        data: {
          storageKey,
          variants: Object.fromEntries(
            Object.entries(processed.variants).map(([name, v]) => [
              name,
              { width: v.width, height: v.height },
            ]),
          ),
        },
        select: {
          id: true,
          storageKey: true,
          width: true,
          height: true,
          blurDataUrl: true,
          position: true,
          isApproved: true,
          rejectedReason: true,
        },
      });

      // Новое фото ещё не одобрено и публично не видно, но обложка кабинета
      // и порядок уже изменились — кэш всё равно стоит сбросить.
      fastify.revalidate([profileTag(owned.slug), PROFILES_TAG]);
      return reply.status(201).send(await toOwnPhoto(saved));
    },
  );

  fastify.delete(
    '/me/profiles/:id/photos/:photoId',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['photos'],
        params: z.object({ id: z.string().min(1), photoId: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      const photo = await fastify.prisma.photo.findFirst({
        where: { id: request.params.photoId, profileId: request.params.id, deletedAt: null },
        select: { id: true, storageKey: true },
      });
      if (!photo) throw fastify.httpErrors.notFound('Фотография не найдена');

      // Мягкое удаление: ошибочное действие владельца обратимо, стирание
      // из хранилища — нет. Публично фото пропадает сразу.
      await fastify.prisma.photo.update({
        where: { id: photo.id },
        data: { deletedAt: new Date(), isApproved: false },
      });

      // Из публичного префикса убираем немедленно: пока файл там лежит,
      // он доступен по прямой ссылке кому угодно.
      if (isPublicKey(photo.storageKey)) {
        await Promise.all(
          ['thumb', 'card', 'full'].map((name) =>
            deleteObject(`${photo.storageKey}/${name}.webp`).catch((error) =>
              fastify.log.error({ err: error }, 'не удалось убрать файл из публичного префикса'),
            ),
          ),
        );
      }

      fastify.revalidate([profileTag(owned.slug), PROFILES_TAG]);
      return { ok: true as const };
    },
  );

  fastify.patch(
    '/me/profiles/:id/photos/order',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['photos'],
        params: z.object({ id: z.string().min(1) }),
        body: photoOrderSchema,
        response: { 200: z.array(ownPhotoSchema) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      const own = await fastify.prisma.photo.findMany({
        where: { profileId: request.params.id, deletedAt: null },
        select: { id: true },
      });
      const ownIds = new Set(own.map((p) => p.id));

      // Чужой id в списке — попытка переставить фото соседней анкеты.
      if (request.body.ids.some((id) => !ownIds.has(id))) {
        throw fastify.httpErrors.badRequest('Список содержит посторонние фотографии');
      }

      await fastify.prisma.$transaction(
        request.body.ids.map((id, index) =>
          fastify.prisma.photo.update({ where: { id }, data: { position: index } }),
        ),
      );

      const rows = await fastify.prisma.photo.findMany({
        where: { profileId: request.params.id, deletedAt: null },
        orderBy: { position: 'asc' },
        select: {
          id: true,
          storageKey: true,
          width: true,
          height: true,
          blurDataUrl: true,
          position: true,
          isApproved: true,
          rejectedReason: true,
        },
      });

      fastify.revalidate([profileTag(owned.slug), PROFILES_TAG]);
      return Promise.all(rows.map(toOwnPhoto));
    },
  );
};

export { toOwnPhoto };
