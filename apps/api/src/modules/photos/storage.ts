import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../../env.js';
import { VARIANT_WIDTHS } from './images.js';

/**
 * Два префикса — это не организация папок, а граница доступа. Бакет отдаёт
 * анонимно только `public/`, поэтому неодобренное фото физически недоступно
 * по прямой ссылке, даже если её угадать. Публичным оно становится ровно
 * в момент одобрения — переносом в `public/`.
 */
export const PENDING_PREFIX = 'pending';
export const PUBLIC_PREFIX = 'public';
/**
 * Снимки для верификации личности. Третий префикс, а не `pending`, потому
 * что у него другая судьба: `pending` существует, чтобы однажды переехать
 * в `public`, а эти файлы публичными не станут никогда и удаляются по
 * сроку хранения.
 */
export const VERIFICATION_PREFIX = 'verification';

const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  // MinIO адресует бакет путём, а не поддоменом.
  forcePathStyle: true,
});

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function moveObject(from: string, to: string): Promise<void> {
  await client.send(
    new CopyObjectCommand({
      Bucket: env.S3_BUCKET,
      CopySource: `${env.S3_BUCKET}/${from}`,
      Key: to,
    }),
  );
  await deleteObject(from);
}

/**
 * Чтение объекта для раздачи через API. Нужно неодобренным фотографиям:
 * анонимно их бакет не отдаёт, а подписанная ссылка здесь не работает —
 * подписант знает только внутренний адрес хранилища (`http://minio:9000`),
 * и такую ссылку браузер не откроет. Пробовать подписывать против внешнего
 * адреса тоже нечего: Caddy переписывает путь, подставляя имя бакета, а
 * подпись считается по пути, и MinIO ответит SignatureDoesNotMatch.
 *
 * Поэтому байты идёт отдавать сам API, проверяя права на каждый запрос.
 * Заодно исчезает ссылка, работающая у любого, кому её переслали.
 */
export async function getObject(key: string): Promise<{
  body: NodeJS.ReadableStream;
  contentType: string;
  contentLength?: number;
}> {
  const out = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!out.Body) throw new Error(`Объект пуст: ${key}`);
  return {
    body: out.Body as NodeJS.ReadableStream,
    contentType: out.ContentType ?? 'application/octet-stream',
    ...(out.ContentLength === undefined ? {} : { contentLength: out.ContentLength }),
  };
}

/** Адрес, по которому владелец видит своё неодобренное фото. */
export function ownPhotoUrl(photoId: string, variant = 'card'): string {
  return `${apiBase()}/api/v1/me/photos/${photoId}/file?variant=${variant}`;
}

/** То же для модератора: он смотрит чужие анкеты, права другие. */
export function moderationPhotoUrl(photoId: string, variant = 'card'): string {
  return `${apiBase()}/api/v1/moderation/photos/${photoId}/file?variant=${variant}`;
}

/** Снимок из заявки на верификацию. Отдаётся только персоналу, по сессии. */
export function verificationPhotoUrl(requestId: string, kind: string): string {
  return `${apiBase()}/api/v1/moderation/identity/${requestId}/photo/${kind}`;
}

function apiBase(): string {
  return env.PUBLIC_API_URL.replace(/\/$/, '');
}

export function publicUrl(key: string): string {
  return `${env.MEDIA_BASE_URL.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
}

export const isPublicKey = (key: string) => key.startsWith(`${PUBLIC_PREFIX}/`);

/** Хранилище отвечает так, когда объекта нет. Это не сбой. */
function isMissingObject(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  const name = (error as { name?: string })?.name;
  return status === 404 || name === 'NoSuchKey' || name === 'NotFound';
}

/**
 * Удаляет из хранилища все файлы одной фотографии — все её размеры.
 *
 * Существует отдельно и используется всюду, где исчезает фотография:
 * удаление анкеты, удаление учётной записи, чистка мягко удалённых. Каскад
 * в базе про файлы ничего не знает, и любое место, которое станет удалять
 * их «по-своему», рано или поздно пропустит вариант и оставит файл в бакете.
 *
 * **Отсутствующий объект проглатывается, недоступное хранилище — нет.**
 * Разница принципиальна: в первом случае файла и так нет, во втором — он
 * есть, и если промолчать, вызывающий удалит строки и потеряет ключи.
 * Файл останется в бакете навсегда, а одобренные лежат под публичным
 * префиксом. Пусть лучше удаление не пройдёт и повторится следующим циклом.
 */
export async function deletePhotoFiles(storageKey: string): Promise<void> {
  for (const variant of Object.keys(VARIANT_WIDTHS)) {
    try {
      await deleteObject(`${storageKey}/${variant}.webp`);
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  }
}
