/**
 * Разовая диагностика "unreadable" из import-agency-profiles.ts: там
 * processImage() глотает настоящую ошибку sharp за общим ImageError('unreadable').
 * Этот скрипт воспроизводит окружение импорта максимально точно — включая
 * инициализацию PrismaClient с тем же PrismaPg-адаптером, ДО вызова sharp —
 * чтобы проверить гипотезу о конфликте нативных биндингов sharp/Prisma в
 * одном процессе (в изолированном вызове без Prisma sharp работает нормально).
 *
 * Запуск: node dist/scripts/diagnose-sharp.js /путь/к/файлу.jpg
 */
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import { PrismaClient } from '../generated/prisma/client.js';

async function main(filePath: string) {
  console.log('--- Без Prisma ---');
  await tryReadMetadata(filePath);

  console.log('\n--- Инициализирую PrismaClient (как в import-agency-profiles.ts) ---');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL не задан — пропускаю Prisma-часть теста.');
    return;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  await prisma.$connect();
  console.log('Prisma подключена. Теперь снова пробую sharp на том же файле:');
  await tryReadMetadata(filePath);
  await prisma.$disconnect();
}

async function tryReadMetadata(filePath: string) {
  const buffer = await readFile(filePath);
  console.log('прочитано байт:', buffer.byteLength);
  try {
    const metadata = await sharp(buffer).metadata();
    console.log('metadata OK: format=%s, %sx%s', metadata.format, metadata.width, metadata.height);
  } catch (err) {
    console.error('РЕАЛЬНАЯ ОШИБКА sharp:', err);
  }
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Использование: node diagnose-sharp.js /путь/к/файлу.jpg');
  process.exit(1);
} else {
  main(filePath).catch((err) => {
    console.error('Скрипт упал:', err);
    process.exit(1);
  });
}
