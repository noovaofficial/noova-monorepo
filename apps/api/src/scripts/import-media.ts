/**
 * Восстановление медиа из архива, снятого export-media: tar из stdin
 * раскладывается по объектам хранилища под теми же ключами.
 *
 * Существующие объекты перезаписываются, лишние не удаляются: скрипт
 * возвращает утраченное, а не приводит хранилище к состоянию архива.
 *
 * Запуск (его зовёт infra/backup/restore-media.sh):
 *   gunzip -c media.tar.gz | docker compose run --rm --no-deps -T api node dist/scripts/import-media.js
 */
import 'dotenv/config';
import { Readable } from 'node:stream';
import {
  PENDING_PREFIX,
  PUBLIC_PREFIX,
  putObjectStream,
  VERIFICATION_PREFIX,
} from '../modules/photos/storage.js';
import { ByteReader, parseTarHeader, tarPadding } from '../modules/photos/tar.js';

/** В хранилище попадает только то, что там и должно лежать: архив — внешний
 *  вход, и запись с чужим именем не должна стать объектом. */
const PREFIXES = [PENDING_PREFIX, PUBLIC_PREFIX, VERIFICATION_PREFIX].map((p) => `${p}/`);

function contentType(key: string): string {
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

async function main() {
  const reader = new ByteReader(process.stdin as AsyncIterable<Buffer>);
  let restored = 0;
  let skipped = 0;
  for (;;) {
    const header = await reader.exact(512);
    const entry = header && parseTarHeader(header);
    if (!entry) break;

    const wanted = entry.isFile && PREFIXES.some((prefix) => entry.path.startsWith(prefix));
    if (wanted) {
      await putObjectStream(
        entry.path,
        Readable.from(reader.take(entry.size)),
        entry.size,
        contentType(entry.path),
      );
      restored += 1;
    } else {
      for await (const _ of reader.take(entry.size)) void _;
      if (entry.isFile) skipped += 1;
    }
    await reader.exact(tarPadding(entry.size).length);
  }
  console.error(`[import-media] восстановлено: ${restored}, пропущено: ${skipped}`);
  if (restored === 0) {
    throw new Error('в архиве нет объектов — это снимок тома MinIO, а не копия через S3?');
  }
}

main().catch((error) => {
  console.error('[import-media] восстановление не выполнено:', error);
  process.exit(1);
});
