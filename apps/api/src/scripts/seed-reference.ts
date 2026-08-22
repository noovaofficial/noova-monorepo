/**
 * Справочные данные для прода: услуги, города, районы. Всё, без чего не
 * пройти регистрацию и не опубликовать анкету, — но без самих анкет и
 * учётных записей: их на проде создают люди, а не сид.
 *
 *   локально:  pnpm --filter @noova/api db:seed:reference
 *   на сервере: docker compose exec api node dist/scripts/seed-reference.js
 *
 * Живёт в `src/scripts`, а не в `prisma/`, намеренно: в прод-образе нет
 * dev-зависимостей, а значит и `tsx`, — запустить там можно только то, что
 * собрано в `dist` (см. tsup.config.ts).
 *
 * Идемпотентно: повторный запуск обновляет существующее и ничего не удаляет.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { CITIES } from '../../prisma/locations.js';
import { SERVICE_CATALOG, SERVICE_GROUPS } from '../../prisma/services.js';
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function seedServices() {
  for (const [index, service] of SERVICE_CATALOG.entries()) {
    const position = SERVICE_GROUPS.indexOf(service.group as never) * 100 + index;
    const fields = {
      group: service.group,
      appliesTo: service.appliesTo,
      position,
      isActive: true,
    };
    await prisma.service.upsert({
      where: { key: service.key },
      create: { key: service.key, ...fields },
      update: fields,
    });
  }

  // Услугу, выпавшую из каталога, не удаляем: она может быть выбрана в анкетах,
  // и удаление порвало бы связи. Просто скрываем из выбора.
  const keys = SERVICE_CATALOG.map((s) => s.key);
  const { count } = await prisma.service.updateMany({
    where: { key: { notIn: keys } },
    data: { isActive: false },
  });

  console.log(`Услуги: ${SERVICE_CATALOG.length} активных, ${count} деактивировано`);
}

async function seedLocations() {
  let districtCount = 0;

  for (const city of CITIES) {
    const { districts, ...fields } = city;
    const saved = await prisma.city.upsert({
      where: { slug: city.slug },
      create: fields,
      update: {
        name: fields.name,
        countryCode: fields.countryCode,
        lat: fields.lat,
        lng: fields.lng,
      },
    });

    for (const district of districts) {
      // Район не удаляем, даже если он выпал из справочника: на него могут
      // ссылаться анкеты, а связь строгая — удаление уронило бы их.
      await prisma.district.upsert({
        where: { cityId_slug: { cityId: saved.id, slug: district.slug } },
        create: { ...district, cityId: saved.id },
        update: { name: district.name, lat: district.lat, lng: district.lng },
      });
      districtCount += 1;
    }
  }

  console.log(`Города: ${CITIES.length}, районов: ${districtCount}`);
}

async function main() {
  await seedServices();
  await seedLocations();
  console.log('Справочники готовы.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
