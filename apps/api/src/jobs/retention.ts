import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Одноразовые токены подтверждения почты и сброса пароля. Использованный или
 * просроченный токен уже не работает — но остаётся строкой, связывающей
 * пользователя с действием и временем. Хранить это дольше, чем нужно для
 * расследования недавнего инцидента, незачем.
 */
export async function purgeAuthTokens(
  prisma: PrismaClient,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.authToken.deleteMany({
    where: {
      // Только отработавшие: живой неиспользованный токен трогать нельзя,
      // иначе ссылка из письма перестанет работать раньше своего срока.
      OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }],
    },
  });
  return count;
}

/**
 * Журнал решений модерации. Нужен, чтобы разобрать спорное решение и увидеть,
 * кто его принял, — но это данные о сотрудниках и о людях, чьи анкеты
 * рассматривались. Годовой срок покрывает и разбор жалобы, и типичный
 * период, за который запрашивают объяснения.
 */
export async function purgeModerationActions(
  prisma: PrismaClient,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.moderationAction.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

/**
 * Физическое удаление учётных записей, для которых истекла отсрочка.
 *
 * **Файлы удаляются до строк, и это главное здесь.** `Photo` каскадится от
 * `Profile`, а тот от `User` — удали пользователя, и строки исчезнут, а
 * объекты в хранилище останутся навсегда: фотографии удалённой учётки будут
 * лежать в бакете, причём одобренные — под публичным префиксом. Каскад про
 * файлы ничего не знает, поэтому их нужно собрать заранее.
 */
export async function purgeDeletedAccounts(
  prisma: PrismaClient,
  graceDays: number,
  /** Удаление всех файлов одной фотографии — `deletePhotoFiles`. */
  deleteFile: (storageKey: string) => Promise<void>,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000);

  const users = await prisma.user.findMany({
    where: { deletionRequestedAt: { not: null, lte: cutoff } },
    select: {
      id: true,
      profiles: { select: { photos: { select: { storageKey: true } } } },
    },
  });

  for (const user of users) {
    const keys = user.profiles.flatMap((profile) =>
      profile.photos.map((photo) => photo.storageKey),
    );

    // Удаление файлов вынесено в `deletePhotoFiles` и используется всюду,
    // где исчезает фотография: два «своих» способа однажды разойдутся,
    // и файл останется в бакете.
    for (const key of keys) {
      await deleteFile(key);
    }

    // Строки удаляет каскад: анкеты, фото, контакты, избранное, отзывы.
    // Журнал модерации связан с пользователем строковым `subjectId` без
    // внешнего ключа и переживает удаление — он о решениях сотрудников,
    // и стирать его вместе с учёткой значило бы терять доказательства.
    await prisma.user.delete({ where: { id: user.id } });
  }

  return users.length;
}
