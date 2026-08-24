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
import { DEFAULT_LOCALE, LOCALES, type Translated, translatedSchema } from '@noova/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { CITIES } from '../../prisma/locations.js';
import { SERVICE_GROUP_NAMES, SERVICE_NAMES } from '../../prisma/reference-translations.js';
import { SERVICE_CATALOG, SERVICE_GROUPS } from '../../prisma/services.js';
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Неполный перевод — это ошибка сида, а не повод подставить запасное
 * значение: молчаливая подмена доехала бы до прода и обнаружилась бы уже
 * посетителем. Падаем здесь, где виноватый очевиден.
 */
function check(value: unknown, what: string): Translated {
  const parsed = translatedSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Неполный перевод ${what}: нужны все локали (${LOCALES.join(', ')}).`);
  }
  return parsed.data;
}

function names(table: Record<string, unknown>, key: string, what: string): Translated {
  return check(table[key], what);
}

async function writeTranslations(
  translated: Translated,
  write: (locale: string, name: string) => Promise<unknown>,
): Promise<void> {
  for (const locale of LOCALES) await write(locale, translated[locale]);
}

async function seedServices() {
  for (const [index, service] of SERVICE_CATALOG.entries()) {
    const position = SERVICE_GROUPS.indexOf(service.group as never) * 100 + index;
    const fields = {
      group: service.group,
      appliesTo: service.appliesTo,
      position,
      isActive: true,
    };
    const saved = await prisma.service.upsert({
      where: { key: service.key },
      create: { key: service.key, ...fields },
      update: fields,
    });

    await writeTranslations(
      names(SERVICE_NAMES, service.key, `услуги ${service.key}`),
      (locale, name) =>
        prisma.serviceTranslation.upsert({
          where: { serviceId_locale: { serviceId: saved.id, locale } },
          create: { serviceId: saved.id, locale, name },
          update: { name },
        }),
    );
  }

  for (const groupKey of new Set(SERVICE_CATALOG.map((s) => s.group))) {
    await writeTranslations(
      names(SERVICE_GROUP_NAMES, groupKey, `группы ${groupKey}`),
      (locale, name) =>
        prisma.serviceGroupTranslation.upsert({
          where: { groupKey_locale: { groupKey, locale } },
          create: { groupKey, locale, name },
          update: { name },
        }),
    );
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
    const cityName = check(city.name, `города ${city.slug}`);
    // `City.name` остаётся как техническое имя для админки и журналов:
    // показывать его посетителю больше нельзя — для этого есть переводы.
    const fields = {
      name: cityName[DEFAULT_LOCALE],
      countryCode: city.countryCode,
      lat: city.lat,
      lng: city.lng,
    };
    const saved = await prisma.city.upsert({
      where: { slug: city.slug },
      create: { slug: city.slug, ...fields },
      update: fields,
    });

    await writeTranslations(cityName, (locale, name) =>
      prisma.cityTranslation.upsert({
        where: { cityId_locale: { cityId: saved.id, locale } },
        create: { cityId: saved.id, locale, name },
        update: { name },
      }),
    );

    for (const district of city.districts) {
      const districtName = check(district.name, `района ${city.slug}/${district.slug}`);
      // Район не удаляем, даже если он выпал из справочника: на него могут
      // ссылаться анкеты, а связь строгая — удаление уронило бы их.
      const savedDistrict = await prisma.district.upsert({
        where: { cityId_slug: { cityId: saved.id, slug: district.slug } },
        create: {
          slug: district.slug,
          name: districtName[DEFAULT_LOCALE],
          lat: district.lat,
          lng: district.lng,
          cityId: saved.id,
        },
        update: { name: districtName[DEFAULT_LOCALE], lat: district.lat, lng: district.lng },
      });

      await writeTranslations(districtName, (locale, name) =>
        prisma.districtTranslation.upsert({
          where: { districtId_locale: { districtId: savedDistrict.id, locale } },
          create: { districtId: savedDistrict.id, locale, name },
          update: { name },
        }),
      );
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
