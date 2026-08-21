import type { PrismaClient } from '../../generated/prisma/client.js';
import { VARIANT_WIDTHS } from './images.js';
import { deleteObject, moveObject, PENDING_PREFIX, PUBLIC_PREFIX } from './storage.js';

/**
 * Одобрение фотографии. Флаг в БД — только половина дела: пока файлы лежат
 * в `pending/`, они недоступны анонимно, и публичная страница показала бы
 * битые картинки. Поэтому одобрение — это перенос объектов в публичный
 * префикс, и только потом смена флага.
 *
 * Вынесено отдельно, потому что этим будет пользоваться модераторская
 * очередь (N-06), а не только сценарий разработки.
 */
export async function approvePhoto(prisma: PrismaClient, photoId: string): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { id: true, profileId: true, storageKey: true, isApproved: true, deletedAt: true },
  });

  if (!photo || photo.deletedAt) throw new Error('Фотография не найдена');
  if (photo.isApproved) return;

  const publicKey = `${PUBLIC_PREFIX}/${photo.profileId}/${photo.id}`;

  for (const name of Object.keys(VARIANT_WIDTHS)) {
    await moveObject(`${photo.storageKey}/${name}.webp`, `${publicKey}/${name}.webp`);
  }

  await prisma.photo.update({
    where: { id: photo.id },
    data: { storageKey: publicKey, isApproved: true, rejectedReason: null },
  });
}

/**
 * Отклонение. Файлы остаются в `pending/` — владелец должен увидеть, что
 * именно не прошло, иначе исправить он ничего не сможет.
 */
export async function rejectPhoto(
  prisma: PrismaClient,
  photoId: string,
  reason: string,
): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { id: true, profileId: true, storageKey: true, isApproved: true },
  });
  if (!photo) throw new Error('Фотография не найдена');

  // Ранее одобренное фото возвращаем из публичного префикса: оставить его
  // там значит оставить доступным по прямой ссылке.
  if (photo.isApproved) {
    const pendingKey = `${PENDING_PREFIX}/${photo.profileId}/${photo.id}`;
    for (const name of Object.keys(VARIANT_WIDTHS)) {
      await moveObject(`${photo.storageKey}/${name}.webp`, `${pendingKey}/${name}.webp`);
    }
    await prisma.photo.update({
      where: { id: photo.id },
      data: { storageKey: pendingKey },
    });
  }

  await prisma.photo.update({
    where: { id: photo.id },
    data: { isApproved: false, rejectedReason: reason },
  });
}

/** Физическая чистка мягко удалённых файлов. Вызывается по расписанию. */
export async function purgeDeletedPhotos(
  prisma: PrismaClient,
  olderThanDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.photo.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, storageKey: true },
  });

  for (const row of rows) {
    for (const name of Object.keys(VARIANT_WIDTHS)) {
      await deleteObject(`${row.storageKey}/${name}.webp`).catch(() => undefined);
    }
    await prisma.photo.delete({ where: { id: row.id } });
  }

  return rows.length;
}
