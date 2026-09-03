import type { Redis } from 'ioredis';
import { pino } from 'pino';
import { env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { loggerOptions } from '../logger.js';
import { pushMail } from '../modules/auth/mail-queue.js';
import { expireListings } from '../modules/billing/listing.js';
import { expireTopPlacements } from '../modules/billing/top.js';
import { purgeDeletedPhotos } from '../modules/photos/moderation.js';
import { deletePhotoFiles } from '../modules/photos/storage.js';
import { purgeProfileEvents } from '../modules/profiles/retention.js';
import { purgeVerificationDocuments } from '../modules/verification/service.js';
import { postRevalidate } from '../plugins/revalidate.js';
import { purgeAuthTokens, purgeDeletedAccounts, purgeModerationActions } from './retention.js';

const log = pino({ ...loggerOptions, name: 'jobs' });

/** Что есть у процесса задач кроме базы. Redis — для очереди писем. */
export type JobDeps = { redis?: Redis };

export type Job = {
  name: string;
  /** Сколько записей убрано. Число попадает в лог — молчаливая чистка
   *  неотличима от незапущенной. */
  run: (prisma: PrismaClient, deps: JobDeps) => Promise<number>;
};

/**
 * Список задач цикла. Сроки берутся из конфигурации: это обязательства по
 * хранению персональных данных, и менять их должно быть можно без выката.
 */
export const JOBS: Job[] = [
  {
    // Истёкшие места в ТОПе освобождаются, флаг с анкет снимается (§3.4).
    name: 'top-expiry',
    run: (prisma) =>
      expireTopPlacements(prisma, { revalidate: (tags) => postRevalidate(tags, log) }),
  },
  {
    // Истечение размещений (payments.md, этап 5): активные → льготные дни →
    // снятие с публикации. Число — сколько размещений сменили состояние.
    name: 'listing-expiry',
    run: (prisma, deps) =>
      expireListings(prisma, {
        graceDays: env.LISTING_GRACE_DAYS,
        reminderDays: env.LISTING_REMINDER_DAYS,
        // Письма — через очередь API: у процесса задач своего SMTP нет.
        notify: deps.redis ? (mail) => pushMail(deps.redis as Redis, mail) : undefined,
        revalidate: (tags) => postRevalidate(tags, log),
      }),
  },
  {
    name: 'deleted-photos',
    run: (prisma) => purgeDeletedPhotos(prisma, env.RETENTION_DELETED_PHOTOS_DAYS),
  },
  {
    name: 'auth-tokens',
    run: (prisma) => purgeAuthTokens(prisma, env.RETENTION_AUTH_TOKENS_DAYS),
  },
  {
    name: 'profile-events',
    run: (prisma) => purgeProfileEvents(prisma, env.RETENTION_PROFILE_EVENTS_DAYS),
  },
  {
    name: 'deleted-accounts',
    run: (prisma) =>
      purgeDeletedAccounts(prisma, env.ACCOUNT_DELETION_GRACE_DAYS, deletePhotoFiles),
  },
  {
    // Снимки документов после решения по заявке (L-02, D-12): особая
    // категория, хранится ровно столько, сколько нужно на разбор спора.
    // Срок отсчитывается от `reviewedAt`, а не от подачи: пока заявку
    // не рассмотрели, удалять снимки не по чему.
    name: 'verification-docs',
    run: (prisma) => purgeVerificationDocuments(prisma, env.RETENTION_VERIFICATION_DOCS_DAYS),
  },
  {
    name: 'moderation-actions',
    run: (prisma) => purgeModerationActions(prisma, env.RETENTION_MODERATION_ACTIONS_DAYS),
  },
];
