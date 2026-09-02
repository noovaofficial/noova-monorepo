import type {
  VerificationPhotoKind,
  VerificationRequestDetail,
  VerificationRequestItem,
} from '@noova/shared';
import { VERIFICATION_PHOTO_KINDS } from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  deleteObject,
  getObject,
  putObject,
  VERIFICATION_PREFIX,
  verificationPhotoUrl,
} from '../photos/storage.js';

/**
 * Хранение снимков верификации и представление заявок.
 *
 * Ключи собираются в одном месте: по ним же идёт удаление при чистке и при
 * удалении учётной записи, и разойтись эти два места не должны.
 */

export const verificationKey = (requestId: string, kind: VerificationPhotoKind): string =>
  `${VERIFICATION_PREFIX}/${requestId}/${kind}.webp`;

export async function putVerificationPhoto(
  requestId: string,
  kind: VerificationPhotoKind,
  body: Buffer,
): Promise<string> {
  const key = verificationKey(requestId, kind);
  await putObject(key, body, 'image/webp');
  return key;
}

export const readVerificationPhoto = (key: string) => getObject(key);

/** Удаляет все снимки заявки. Отсутствующий объект — не ошибка: чистка идемпотентна. */
export async function deleteVerificationPhotos(requestId: string): Promise<void> {
  await Promise.all(
    VERIFICATION_PHOTO_KINDS.map((kind) =>
      deleteObject(verificationKey(requestId, kind)).catch(() => undefined),
    ),
  );
}

/** Один набор полей на список и на карточку заявки. */
export const verificationSelect = {
  id: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  purgedAt: true,
  profile: {
    select: {
      id: true,
      slug: true,
      displayName: true,
      kind: true,
      isVerified: true,
      city: { select: { name: true } },
      owner: { select: { email: true } },
    },
  },
} as const;

type Row = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: Date;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  purgedAt: Date | null;
  profile: {
    id: string;
    slug: string;
    displayName: string;
    kind: 'escort' | 'massage';
    isVerified: boolean;
    city: { name: string };
    owner: { email: string };
  };
};

export function toVerificationItem(row: Row): VerificationRequestItem {
  return {
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    profile: {
      id: row.profile.id,
      slug: row.profile.slug,
      displayName: row.profile.displayName,
      cityName: row.profile.city.name,
      kind: row.profile.kind,
      isVerified: row.profile.isVerified,
    },
    ownerEmail: row.profile.owner.email,
  };
}

export function toVerificationDetail(row: Row): VerificationRequestDetail {
  return {
    ...toVerificationItem(row),
    // Адреса ведут в API и работают только у персонала: прямых ссылок на
    // документ не существует.
    photos: Object.fromEntries(
      VERIFICATION_PHOTO_KINDS.map((kind) => [kind, verificationPhotoUrl(row.id, kind)]),
    ) as VerificationRequestDetail['photos'],
    isPurged: row.purgedAt !== null,
  };
}

/**
 * Снимки документов после решения (planning.md §5: данные особой категории).
 * Удаляются файлы, заявка остаётся — след решения нужен для разбора спора,
 * сами документы для этого не нужны.
 */
export async function purgeVerificationDocuments(
  prisma: PrismaClient,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.verificationRequest.findMany({
    where: { purgedAt: null, reviewedAt: { not: null, lt: cutoff } },
    select: { id: true },
  });

  for (const row of rows) {
    await deleteVerificationPhotos(row.id);
    await prisma.verificationRequest.update({
      where: { id: row.id },
      data: { purgedAt: now, faceKey: '', documentKey: '', togetherKey: '' },
    });
  }
  return rows.length;
}
