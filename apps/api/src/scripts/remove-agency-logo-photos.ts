/**
 * Разовая чистка: у Airport Escort Frankfurt (третье агентство) сайт-
 * источник отдавал свой собственный логотип ("AEF", 150x100) вперемешку
 * с настоящими фото модели — дважды на каждой странице (.png и .webp,
 * два разных файла с одинаковой картинкой), и скрейпер утащил их вместе
 * с остальной галереей. Ни у одной настоящей фотографии в этом агентстве
 * размер 150x100 не встречается (проверено: 164 = 82 анкеты × 2 логотипа,
 * без остатка), так что фильтр по точным размерам безопасен.
 *
 * После удаления схлопывает position оставшихся фото анкеты (0..n-1) —
 * без пропусков.
 *
 * Запуск:
 *   docker compose exec -e AGENCY_EMAIL=airportescortfrankfurt@noova.cc \
 *     api node dist/scripts/remove-agency-logo-photos.js
 *
 * Необязательные переменные: LOGO_WIDTH, LOGO_HEIGHT (по умолчанию 150x100).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { deletePhotoFiles } from '../modules/photos/storage.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const AGENCY_EMAIL = process.env.AGENCY_EMAIL;
if (!AGENCY_EMAIL) {
  console.error('Нужна переменная окружения: AGENCY_EMAIL');
  process.exit(1);
}

const LOGO_WIDTH = Number(process.env.LOGO_WIDTH ?? 150);
const LOGO_HEIGHT = Number(process.env.LOGO_HEIGHT ?? 100);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: AGENCY_EMAIL },
    select: { id: true },
  });
  if (!user) throw new Error(`Аккаунт ${AGENCY_EMAIL} не найден`);

  const logos = await prisma.photo.findMany({
    where: {
      width: LOGO_WIDTH,
      height: LOGO_HEIGHT,
      profile: { ownerId: user.id },
    },
    select: { id: true, storageKey: true, profileId: true },
  });

  console.log(`Найдено фото-логотипов ${LOGO_WIDTH}x${LOGO_HEIGHT}: ${logos.length}`);

  const affectedProfileIds = new Set<string>();
  for (const photo of logos) {
    await deletePhotoFiles(photo.storageKey);
    await prisma.photo.delete({ where: { id: photo.id } });
    affectedProfileIds.add(photo.profileId);
  }
  console.log(`Удалено: ${logos.length}. Затронуто анкет: ${affectedProfileIds.size}.`);

  let renumbered = 0;
  for (const profileId of affectedProfileIds) {
    const remaining = await prisma.photo.findMany({
      where: { profileId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    for (const [i, photo] of remaining.entries()) {
      await prisma.photo.update({ where: { id: photo.id }, data: { position: i } });
    }
    renumbered += 1;
  }
  console.log(`Позиции пересчитаны без пропусков у ${renumbered} анкет.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
