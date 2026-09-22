/**
 * Разовая чистка: у Airport Escort Frankfurt (третье агентство) в галереи
 * попали (1) один и тот же посторонний "шапка"-снимок сайта (не имеет
 * отношения к анкете — один и тот же файл на всех 82 страницах-источниках)
 * и (2) повторы одного и того же кадра в разном качестве (сайт отдаёт
 * каждое фото в нескольких форматах/размерах — .webp и .jpg/.png одного
 * кадра, плюс маленькая версия-превью — скрейпер утащил все копии).
 *
 * Список того, что удалять, посчитан заранее локально (перцептивный хэш +
 * сравнение по площади/размеру файла, самая качественная копия каждого
 * кадра остаётся) и передаётся сюда как {profileId: [позиции]} — прямо
 * по Photo.position, без повторной эвристики на сервере.
 *
 * После удаления схлопывает position оставшихся фото анкеты (0..n-1).
 *
 * Запуск:
 *   docker compose exec -e REMOVALS_PATH=/tmp/agency3_removals_by_id.json \
 *     api node dist/scripts/remove-photos-by-position.js
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { deletePhotoFiles } from '../modules/photos/storage.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const REMOVALS_PATH = process.env.REMOVALS_PATH;
if (!REMOVALS_PATH) {
  console.error('Нужна переменная окружения: REMOVALS_PATH (json {profileId: [positions]})');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const removals: Record<string, number[]> = JSON.parse(await readFile(REMOVALS_PATH!, 'utf8'));
  const profileIds = Object.keys(removals);
  console.log(`Анкет в списке: ${profileIds.length}`);

  let totalDeleted = 0;
  let totalRequested = 0;
  for (const profileId of profileIds) {
    const positions = removals[profileId]!;
    totalRequested += positions.length;

    const photos = await prisma.photo.findMany({
      where: { profileId, position: { in: positions } },
      select: { id: true, storageKey: true, position: true },
    });

    if (photos.length !== positions.length) {
      console.warn(
        `  [${profileId}] ожидалось ${positions.length} фото на позициях [${positions.join(',')}], найдено ${photos.length} — пропускаю анкету, разберитесь вручную`,
      );
      continue;
    }

    for (const photo of photos) {
      await deletePhotoFiles(photo.storageKey);
      await prisma.photo.delete({ where: { id: photo.id } });
      totalDeleted += 1;
    }

    const remaining = await prisma.photo.findMany({
      where: { profileId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    for (const [i, photo] of remaining.entries()) {
      await prisma.photo.update({ where: { id: photo.id }, data: { position: i } });
    }

    console.log(`  [${profileId}] удалено ${photos.length}, осталось ${remaining.length}`);
  }

  console.log(`\nГотово: удалено ${totalDeleted}/${totalRequested} запрошенных фото.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
