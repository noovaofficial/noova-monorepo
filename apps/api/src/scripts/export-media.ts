/**
 * Резервная копия медиа: все объекты хранилища одним tar-потоком в stdout.
 *
 * Работает через S3-API, а не через том Docker, поэтому годится и для MinIO,
 * и для внешнего хранилища (Bunny), где тома на сервере нет вовсе. Берёт обе
 * зоны — закрытую и публичную; в архиве объект лежит под своим ключом
 * (`public/…`, `pending/…`, `verification/…`).
 *
 * Запуск (на сервере его зовёт infra/backup/stream.sh):
 *   docker compose run --rm --no-deps -T api node dist/scripts/export-media.js > media.tar
 *
 * В stdout идут только байты архива; счётчик и ошибки — в stderr.
 */
import 'dotenv/config';
import { once } from 'node:events';
import { getObject, listAllObjects } from '../modules/photos/storage.js';
import { TAR_END, tarHeader, tarPadding } from '../modules/photos/tar.js';

/** Пишет в stdout, дожидаясь, пока получатель заберёт: иначе при медленном
 *  канале весь архив копился бы в памяти процесса. */
async function write(chunk: Buffer): Promise<void> {
  if (chunk.length === 0) return;
  if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
}

async function main() {
  let count = 0;
  let bytes = 0;
  for await (const object of listAllObjects()) {
    const { body } = await getObject(object.key);
    await write(tarHeader(object.key, object.size));
    let written = 0;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      written += chunk.length;
      await write(chunk);
    }
    // Размер в заголовке уже ушёл: расхождение сдвинуло бы все следующие
    // записи, и архив читался бы как мусор. Лучше упасть, чем отдать такой.
    if (written !== object.size) {
      throw new Error(`Объект ${object.key} изменился во время копирования`);
    }
    await write(tarPadding(object.size));
    count += 1;
    bytes += object.size;
  }
  await write(TAR_END);
  console.error(`[export-media] объектов: ${count}, байт: ${bytes}`);
}

main().catch((error) => {
  console.error('[export-media] копия не снята:', error);
  process.exit(1);
});
