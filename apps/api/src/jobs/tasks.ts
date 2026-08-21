import { env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { purgeDeletedPhotos } from '../modules/photos/moderation.js';
import { deletePhotoFiles } from '../modules/photos/storage.js';
import { purgeContactReveals } from '../modules/profiles/retention.js';
import { purgeAuthTokens, purgeDeletedAccounts, purgeModerationActions } from './retention.js';

export type Job = {
  name: string;
  /** Сколько записей убрано. Число попадает в лог — молчаливая чистка
   *  неотличима от незапущенной. */
  run: (prisma: PrismaClient) => Promise<number>;
};

/**
 * Список задач цикла. Сроки берутся из конфигурации: это обязательства по
 * хранению персональных данных, и менять их должно быть можно без выката.
 *
 * Документы верификации (N-07) в списке отсутствуют намеренно — приёма
 * документов пока нет, чистить нечего. Задачу вернуть вместе с N-07.
 */
export const JOBS: Job[] = [
  {
    name: 'deleted-photos',
    run: (prisma) => purgeDeletedPhotos(prisma, env.RETENTION_DELETED_PHOTOS_DAYS),
  },
  {
    name: 'auth-tokens',
    run: (prisma) => purgeAuthTokens(prisma, env.RETENTION_AUTH_TOKENS_DAYS),
  },
  {
    name: 'contact-reveals',
    run: (prisma) => purgeContactReveals(prisma, env.RETENTION_CONTACT_REVEALS_DAYS),
  },
  {
    name: 'deleted-accounts',
    run: (prisma) =>
      purgeDeletedAccounts(prisma, env.ACCOUNT_DELETION_GRACE_DAYS, deletePhotoFiles),
  },
  {
    name: 'moderation-actions',
    run: (prisma) => purgeModerationActions(prisma, env.RETENTION_MODERATION_ACTIONS_DAYS),
  },
];
