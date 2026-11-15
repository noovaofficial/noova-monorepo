import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OwnVideo, Video } from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { VISIBLE_LISTING_STATUSES } from '../billing/listing.js';
import {
  deleteObject,
  deleteVideoFiles,
  downloadObject,
  isPublicKey,
  moveObject,
  ownVideoUrl,
  PENDING_PREFIX,
  PUBLIC_PREFIX,
  publicUrl,
  putObjectFromFile,
  VIDEO_FILES,
} from '../photos/storage.js';
import { probeVideo, transcodeVideo, VideoError } from './ffmpeg.js';

/**
 * Жизнь видео анкеты: обработка, модерация, удаление.
 *
 * Обработка идёт фоном в процессе API сразу после загрузки (`enqueueVideo`) —
 * ждать часового цикла задач незачем. Цикл (`recoverStuckVideos`) только
 * страхует: подбирает записи, обработку которых оборвал перезапуск.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Log = { error: (obj: object, msg: string) => void };

/** Сколько раз пробуем обработать, прежде чем признать видео негодным. */
const MAX_ATTEMPTS = 3;
/** Обработка дольше этого — процесс умер; запись можно брать заново. */
const CLAIM_STALE_MS = 15 * 60_000;

export const videoDir = (prefix: string, profileId: string, videoId: string) =>
  `${prefix}/${profileId}/video-${videoId}`;

type VideoRow = {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  storageKey: string;
  width: number;
  height: number;
  durationMs: number;
  isApproved: boolean;
  rejectedReason: string | null;
};

export const ownVideoSelect = {
  id: true,
  status: true,
  storageKey: true,
  width: true,
  height: true,
  durationMs: true,
  isApproved: true,
  rejectedReason: true,
} as const;

/** Одобренное лежит в публичном префиксе, остальное владелец получает через API. */
export function toOwnVideo(row: VideoRow): OwnVideo {
  const ready = row.status === 'ready';
  const open = isPublicKey(row.storageKey);
  return {
    id: row.id,
    status: row.status,
    url: !ready
      ? null
      : open
        ? publicUrl(`${row.storageKey}/${VIDEO_FILES.video}`)
        : ownVideoUrl(row.id, 'video'),
    posterUrl: !ready
      ? null
      : open
        ? publicUrl(`${row.storageKey}/${VIDEO_FILES.poster}`)
        : ownVideoUrl(row.id, 'poster'),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    isApproved: row.isApproved,
    rejectedReason: row.rejectedReason,
  };
}

/**
 * Условие публичного показа: обработано, одобрено — и у владельца действует
 * подписка. Подписка проверяется на чтении, а не флагом на записи: так видео
 * скрывается и возвращается само, без задачи, которая могла бы отстать.
 */
export const publicVideoSelect = {
  where: { status: 'ready', isApproved: true },
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { id: true, storageKey: true, width: true, height: true, durationMs: true },
} satisfies Prisma.Profile$videosArgs;

/**
 * Фильтр «у владельца действует подписка» — для связи `Profile.owner`.
 * Функция, а не константа: listing.ts и этот модуль импортируют друг друга,
 * и на момент загрузки модуля список статусов может быть ещё не определён.
 */
export const ownerSubscribedSelect = () =>
  ({
    select: {
      listings: {
        where: { status: { in: [...VISIBLE_LISTING_STATUSES] } },
        take: 1,
        select: { id: true },
      },
    },
  }) satisfies Prisma.UserDefaultArgs;

export function toPublicVideo(row: {
  id: string;
  storageKey: string;
  width: number;
  height: number;
  durationMs: number;
}): Video {
  return {
    id: row.id,
    url: publicUrl(`${row.storageKey}/${VIDEO_FILES.video}`),
    posterUrl: publicUrl(`${row.storageKey}/${VIDEO_FILES.poster}`),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
  };
}

/**
 * Анкеты владельца с одобренным видео. Их страницы нужно пересобрать, когда
 * подписка началась или кончилась: от неё зависит, показывать ли видео.
 */
export async function videoProfileSlugs(db: Db, userId: string): Promise<string[]> {
  const rows = await db.profile.findMany({
    where: { ownerId: userId, videos: { some: { status: 'ready', isApproved: true } } },
    select: { slug: true },
  });
  return rows.map((row) => row.slug);
}

/**
 * Обработка одного видео. Берёт запись в работу условным обновлением: два
 * процесса (API и цикл задач) одну запись не обработают дважды.
 */
export async function processVideo(
  prisma: PrismaClient,
  videoId: string,
  /** Исходник, ещё лежащий на диске после загрузки, — чтобы не качать его
   *  обратно из хранилища. Нет файла — берём копию оттуда. */
  localSource?: string,
): Promise<void> {
  const now = new Date();
  const claimed = await prisma.video.updateMany({
    where: {
      id: videoId,
      status: 'processing',
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }],
    },
    data: { claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return;

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, storageKey: true, attempts: true },
  });
  if (!video) return;

  const workDir = await mkdtemp(join(tmpdir(), 'noova-video-'));
  try {
    let sourcePath = join(workDir, 'source');
    if (localSource && (await stat(localSource).catch(() => null))) {
      sourcePath = localSource;
    } else {
      await downloadObject(`${video.storageKey}/${VIDEO_FILES.source}`, sourcePath);
    }
    const result = await transcodeVideo(sourcePath, workDir, await probeVideo(sourcePath));

    await putObjectFromFile(
      `${video.storageKey}/${VIDEO_FILES.video}`,
      result.videoPath,
      'video/mp4',
    );
    await putObjectFromFile(
      `${video.storageKey}/${VIDEO_FILES.poster}`,
      result.posterPath,
      'image/webp',
    );

    const saved = await prisma.video.updateMany({
      where: { id: video.id, status: 'processing' },
      data: {
        status: 'ready',
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
        bytes: (await stat(result.videoPath)).size,
        failReason: null,
      },
    });
    // Владелец удалил видео, пока шла обработка: только что загруженные
    // файлы никому не принадлежат — убираем.
    if (saved.count === 0) {
      await deleteVideoFiles(video.storageKey);
      return;
    }
    // Исходник больше не нужен, а в нём метаданные съёмки — не храним.
    await deleteObject(`${video.storageKey}/${VIDEO_FILES.source}`).catch(() => undefined);
  } catch (error) {
    // Негодный файл повторять бессмысленно; сбой окружения — можно, до предела.
    const hopeless = error instanceof VideoError && error.reason !== 'unavailable';
    if (hopeless || video.attempts >= MAX_ATTEMPTS) {
      await prisma.video.updateMany({
        where: { id: video.id, status: 'processing' },
        data: { status: 'failed', failReason: hopeless ? 'unreadable' : 'internal' },
      });
      await deleteVideoFiles(video.storageKey).catch(() => undefined);
    } else {
      // Освобождаем запись: следующая попытка — за циклом задач.
      await prisma.video.updateMany({
        where: { id: video.id, status: 'processing' },
        data: { claimedAt: null },
      });
    }
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Очередь процесса: ffmpeg грузит все ядра, два ролика разом — уже лишнее. */
let chain: Promise<void> = Promise.resolve();

/**
 * Ставит видео на обработку и сразу возвращается — запрос загрузки не ждёт.
 *
 * `uploadDir` — временная папка загрузки с файлом `source`. Очередь берёт
 * исходник прямо оттуда и сама её удаляет. Копия в хранилище при этом
 * остаётся: по ней обработку повторит цикл задач, если процесс перезапустят.
 */
export function enqueueVideo(
  prisma: PrismaClient,
  log: Log,
  videoId: string,
  uploadDir?: string,
): void {
  chain = chain
    .then(() => processVideo(prisma, videoId, uploadDir && join(uploadDir, 'source')))
    .catch((error) => log.error({ err: error, videoId }, 'видео не обработано'))
    .finally(() => (uploadDir ? rm(uploadDir, { recursive: true, force: true }) : undefined));
}

/**
 * Задача цикла: записи, обработку которых оборвал перезапуск или сбой.
 * Возвращает число обработанных. Свежие не трогает — ими занят API.
 */
export async function recoverStuckVideos(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const stale = new Date(now.getTime() - CLAIM_STALE_MS);
  const rows = await prisma.video.findMany({
    where: {
      status: 'processing',
      OR: [{ claimedAt: null, updatedAt: { lt: stale } }, { claimedAt: { lt: stale } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { id: true },
  });
  let done = 0;
  for (const row of rows) {
    try {
      await processVideo(prisma, row.id);
      done += 1;
    } catch {
      // Причина уже записана в строку; одно негодное видео не должно
      // останавливать остальные.
    }
  }
  return done;
}

/** Одобрение — перенос файлов в публичный префикс, как у фото. */
export async function approveVideo(prisma: PrismaClient, videoId: string): Promise<void> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, profileId: true, storageKey: true, status: true, isApproved: true },
  });
  if (video?.status !== 'ready') throw new Error('Видео не найдено');
  if (video.isApproved) return;

  const publicKey = videoDir(PUBLIC_PREFIX, video.profileId, video.id);
  for (const file of [VIDEO_FILES.video, VIDEO_FILES.poster]) {
    await moveObject(`${video.storageKey}/${file}`, `${publicKey}/${file}`);
  }
  await prisma.video.update({
    where: { id: video.id },
    data: { storageKey: publicKey, isApproved: true, rejectedReason: null },
  });
}

/** Отклонение: ранее одобренное возвращается из публичного префикса. */
export async function rejectVideo(
  prisma: PrismaClient,
  videoId: string,
  reason: string,
): Promise<void> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, profileId: true, storageKey: true, status: true },
  });
  if (video?.status !== 'ready') throw new Error('Видео не найдено');

  let storageKey = video.storageKey;
  if (isPublicKey(storageKey)) {
    storageKey = videoDir(PENDING_PREFIX, video.profileId, video.id);
    for (const file of [VIDEO_FILES.video, VIDEO_FILES.poster]) {
      await moveObject(`${video.storageKey}/${file}`, `${storageKey}/${file}`);
    }
  }
  await prisma.video.update({
    where: { id: video.id },
    data: { storageKey, isApproved: false, rejectedReason: reason },
  });
}

/**
 * Файлы всех видео перечисленных анкет — перед удалением анкеты или учётной
 * записи. Строки удалит каскад, а про файлы он не знает (см. `purgeUser`).
 */
export async function deleteProfileVideoFiles(db: Db, profileIds: string[]): Promise<void> {
  if (profileIds.length === 0) return;
  const videos = await db.video.findMany({
    where: { profileId: { in: profileIds } },
    select: { storageKey: true },
  });
  for (const video of videos) await deleteVideoFiles(video.storageKey);
}
