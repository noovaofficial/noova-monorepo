/**
 * Разовая диагностика "unreadable" из import-agency-profiles.ts. Гоняет
 * ПОЛНЫЙ processImage() (не только metadata(), а весь пайплайн: ресайз,
 * вотермарка, webp) по каждому файлу в переданной папке — чтобы найти,
 * какое именно фото и на каком шаге падает, а не гадать по одному файлу.
 *
 * Запуск: node dist/scripts/diagnose-sharp.js /путь/к/папке/photos
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { processImage } from '../modules/photos/images.js';

async function main(dir: string) {
  const files = (await readdir(dir)).sort();
  console.log(`Файлов: ${files.length}`);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const buffer = await readFile(filePath);
    process.stdout.write(`${file} (${buffer.byteLength} байт): `);
    try {
      const result = await processImage(buffer);
      console.log(`OK, ${result.width}x${result.height}, варианты: ${Object.keys(result.variants).join(',')}`);
    } catch (err) {
      console.log('ПАДАЕТ');
      console.error(err);
    }
  }
}

const dir = process.argv[2];
if (!dir) {
  console.error('Использование: node diagnose-sharp.js /путь/к/папке/photos');
  process.exit(1);
} else {
  main(dir).catch((err) => {
    console.error('Скрипт упал:', err);
    process.exit(1);
  });
}
