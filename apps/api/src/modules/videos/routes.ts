import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  MAX_VIDEOS_PER_PROFILE,
  ownVideoSchema,
  ownVideoStateSchema,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { hasVisibleListing } from '../billing/listing.js';
import { clearNeedsEditIfRejected, ownedProfileOr404 } from '../photos/routes.js';
import {
  deleteVideoFiles,
  getObject,
  PENDING_PREFIX,
  putObjectFromFile,
  VIDEO_FILES,
} from '../photos/storage.js';
import { probeVideo, VideoError } from './ffmpeg.js';
import { enqueueVideo, ownVideoSelect, toOwnVideo, videoDir } from './service.js';

/**
 * Видео анкеты глазами владельца. Одно на анкету и только при действующей
 * подписке: без неё загрузка закрыта (402), а одобренное видео скрыто с
 * публичной страницы — см. `publicVideoSelect` в service.ts.
 */
export const videoRoutes: FastifyPluginAsyncZod = async (fastify) => {
  /** Состояние: само видео и можно ли сейчас загружать. Кабинет опрашивает
   *  его, пока идёт обработка. */
  fastify.get(
    '/me/profiles/:id/video',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['videos'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: ownVideoStateSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      await ownedProfileOr404(fastify, userId, request.params.id);
      const [video, hasSubscription] = await Promise.all([
        fastify.prisma.video.findFirst({
          where: { profileId: request.params.id },
          orderBy: { createdAt: 'desc' },
          select: ownVideoSelect,
        }),
        hasVisibleListing(fastify.prisma, userId),
      ]);
      return { video: video ? toOwnVideo(video) : null, hasSubscription };
    },
  );

  fastify.post(
    '/me/profiles/:id/video',
    {
      onRequest: fastify.requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['videos'],
        params: z.object({ id: z.string().min(1) }),
        response: { 201: ownVideoSchema },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      // Проверки до чтения тела: незачем принимать 50 МБ, чтобы отказать.
      if (!(await hasVisibleListing(fastify.prisma, userId))) {
        throw fastify.httpErrors.paymentRequired('Видео доступно только с активной подпиской');
      }
      const count = await fastify.prisma.video.count({ where: { profileId: owned.id } });
      if (count >= MAX_VIDEOS_PER_PROFILE) {
        throw fastify.httpErrors.conflict('У анкеты уже есть видео — сначала удалите его');
      }

      const file = await request.file({ limits: { fileSize: VIDEO_MAX_BYTES } });
      if (!file) throw fastify.httpErrors.badRequest('Файл не передан');

      // На диск, а не в память: файл большой, а ffprobe всё равно читает путь.
      const workDir = await mkdtemp(join(tmpdir(), 'noova-upload-'));
      try {
        const sourcePath = join(workDir, 'source');
        await pipeline(file.file, createWriteStream(sourcePath));
        if (file.file.truncated) {
          throw fastify.httpErrors.payloadTooLarge('Файл больше допустимого размера');
        }

        // Формат и длительность — по содержимому, сразу: владелец узнаёт об
        // отказе в ответе на загрузку, а не из статуса через минуту.
        try {
          await probeVideo(sourcePath);
        } catch (error) {
          if (!(error instanceof VideoError)) throw error;
          if (error.reason === 'too_long') {
            throw fastify.httpErrors.badRequest(`Видео длиннее ${VIDEO_MAX_SECONDS} секунд`);
          }
          if (error.reason === 'unavailable') {
            throw fastify.httpErrors.serviceUnavailable('Обработка видео недоступна');
          }
          throw fastify.httpErrors.badRequest('Файл не является видео поддерживаемого формата');
        }

        // Запись — до загрузки в хранилище: её id входит в ключ объекта.
        const created = await fastify.prisma.video.create({
          data: { profileId: owned.id, storageKey: '' },
          select: { id: true },
        });
        const storageKey = videoDir(PENDING_PREFIX, owned.id, created.id);
        try {
          await putObjectFromFile(
            `${storageKey}/${VIDEO_FILES.source}`,
            sourcePath,
            'application/octet-stream',
          );
        } catch (error) {
          await fastify.prisma.video.delete({ where: { id: created.id } });
          throw error;
        }
        const saved = await fastify.prisma.video.update({
          where: { id: created.id },
          data: { storageKey },
          select: ownVideoSelect,
        });

        await clearNeedsEditIfRejected(fastify, owned);
        enqueueVideo(fastify.prisma, fastify.log, saved.id);
        return reply.status(201).send(toOwnVideo(saved));
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  );

  /**
   * Удаление — сразу и насовсем, без корзины, как у фото: видео одно, и
   * «удалить» здесь почти всегда значит «заменить». Файлы — до строки.
   */
  fastify.delete(
    '/me/profiles/:id/video/:videoId',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['videos'],
        params: z.object({ id: z.string().min(1), videoId: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);
      const video = await fastify.prisma.video.findFirst({
        where: { id: request.params.videoId, profileId: owned.id },
        select: { id: true, storageKey: true },
      });
      if (!video) throw fastify.httpErrors.notFound('Видео не найдено');

      if (video.storageKey) await deleteVideoFiles(video.storageKey);
      await fastify.prisma.video.delete({ where: { id: video.id } });

      await clearNeedsEditIfRejected(fastify, owned);
      fastify.revalidate([profileTag(owned.slug)]);
      return { ok: true as const };
    },
  );

  /** Файл неодобренного видео или его постера — владельцу, по сессии. */
  fastify.get(
    '/me/videos/:id/file',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['videos'],
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ file: z.enum(['video', 'poster']).default('video') }),
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const video = await fastify.prisma.video.findFirst({
        where: { id: request.params.id, status: 'ready', profile: { ownerId: userId } },
        select: { storageKey: true },
      });
      if (!video) throw fastify.httpErrors.notFound('Видео не найдено');
      return sendVideoFile(reply, video.storageKey, request.query.file, request.headers.range);
    },
  );
};

type FileReply = {
  header: (name: string, value: string | number) => unknown;
  status: (code: number) => unknown;
  type: (value: string) => unknown;
  send: (body: unknown) => unknown;
};

/**
 * Раздача файла видео через API — общая для владельца и модератора. С
 * поддержкой `Range`: без частичных ответов Safari ролик не играет, а
 * остальные браузеры не умеют перематывать.
 */
export async function sendVideoFile(
  reply: FileReply,
  storageKey: string,
  file: 'video' | 'poster',
  range: string | undefined,
) {
  const wantsRange = file === 'video' && range !== undefined;
  const object = await getObject(
    `${storageKey}/${VIDEO_FILES[file]}`,
    wantsRange ? range : undefined,
  );
  reply.header('cache-control', 'private, max-age=300');
  // См. такой же заголовок у фото (photos/routes.ts): фронт и API локально
  // живут на разных портах.
  reply.header('cross-origin-resource-policy', 'same-site');
  if (file === 'video') reply.header('accept-ranges', 'bytes');
  if (object.contentRange) {
    reply.status(206);
    reply.header('content-range', object.contentRange);
  }
  reply.type(object.contentType);
  if (object.contentLength !== undefined) reply.header('content-length', object.contentLength);
  return reply.send(object.body);
}
