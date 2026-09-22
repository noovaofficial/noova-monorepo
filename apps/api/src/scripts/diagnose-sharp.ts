/**
 * Разовая диагностика: processImage() в src/modules/photos/images.ts глотает
 * настоящую ошибку sharp и всегда бросает ImageError('unreadable') — этот
 * скрипт вызывает sharp() напрямую на переданном файле и печатает реальную
 * причину, вместо общего "unreadable".
 *
 * Запуск: node dist/scripts/diagnose-sharp.js /путь/к/файлу.jpg
 */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

async function main(filePath: string) {
  console.log('sharp версия:', (sharp as unknown as { versions?: unknown }).versions ?? '?');
  const buffer = await readFile(filePath);
  console.log('прочитано байт:', buffer.byteLength);
  try {
    const metadata = await sharp(buffer).metadata();
    console.log('metadata OK:', metadata);
  } catch (err) {
    console.error('РЕАЛЬНАЯ ОШИБКА sharp:', err);
  }
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Использование: node diagnose-sharp.js /путь/к/файлу.jpg');
  process.exit(1);
} else {
  main(filePath);
}
