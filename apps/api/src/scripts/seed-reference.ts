/**
 * Справочные данные для прода: страны, города, районы, услуги. Всё, без чего
 * не пройти регистрацию и не опубликовать анкету, — но без самих анкет и
 * учётных записей: их на проде создают люди, а не сид.
 *
 *   локально:  pnpm --filter @noova/api db:seed:reference
 *   на сервере: docker compose exec api node dist/scripts/seed-reference.js
 *
 * Источник — `prisma/reference-data.ts`, зеркало базы. Обратное направление,
 * из базы в файл, — `db:export:reference`: справочник редактируется в
 * админке, а в репозиторий возвращается выгрузкой.
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
import { PrismaClient } from '../generated/prisma/client.js';
import { loadReferenceData, referencePath } from '../reference-data.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Читаем в рантайме, а не импортируем: импорт tsup вшил бы справочник в бандл,
// и обновить его на сервере можно было бы только пересборкой образа.
const {
  countries: COUNTRIES,
  cities: CITIES,
  serviceGroups: SERVICE_GROUPS,
  services: SERVICES,
} = loadReferenceData();

/**
 * Неполный перевод — ошибка данных, а не повод подставить запасное значение:
 * молчаливая подмена доехала бы до прода и обнаружилась бы посетителем.
 * Падаем здесь, где виноватый очевиден.
 */
function check(value: unknown, what: string): Translated {
  const parsed = translatedSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Неполный перевод ${what}: нужны все локали (${LOCALES.join(', ')}).`);
  }
  return parsed.data;
}

async function writeTranslations(
  translated: Translated,
  write: (locale: string, name: string) => Promise<unknown>,
): Promise<void> {
  for (const locale of LOCALES) await write(locale, translated[locale]);
}

async function seedServices() {
  for (const group of SERVICE_GROUPS) {
    const name = check(group.name, `группы ${group.key}`);
    await writeTranslations(name, (locale, value) =>
      prisma.serviceGroupTranslation.upsert({
        where: { groupKey_locale: { groupKey: group.key, locale } },
        create: { groupKey: group.key, locale, name: value },
        update: { name: value },
      }),
    );
  }

  for (const service of SERVICES) {
    const name = check(service.name, `услуги ${service.key}`);
    const fields = {
      group: service.group,
      appliesTo: service.appliesTo,
      position: service.position,
      isActive: service.isActive,
    };

    // Ищем по ключу, а id проставляем только при создании: на чистой машине
    // справочник получит те же идентификаторы, что в выгрузке, а на машине,
    // где запись уже есть со своим id, ничего не сломается.
    const saved = await prisma.service.upsert({
      where: { key: service.key },
      create: { id: service.id, key: service.key, ...fields },
      update: fields,
    });

    await writeTranslations(name, (locale, value) =>
      prisma.serviceTranslation.upsert({
        where: { serviceId_locale: { serviceId: saved.id, locale } },
        create: { serviceId: saved.id, locale, name: value },
        update: { name: value },
      }),
    );
  }

  // Услугу, выпавшую из справочника, не удаляем: она может быть выбрана в
  // анкетах, и удаление порвало бы связи. Просто скрываем из выбора.
  const keys = SERVICES.map((s) => s.key);
  const { count } = await prisma.service.updateMany({
    where: { key: { notIn: keys } },
    data: { isActive: false },
  });

  const active = SERVICES.filter((s) => s.isActive).length;
  console.log(
    `Услуги: ${active} активных, ${SERVICES.length - active} отключённых, ${count} лишних скрыто`,
  );
}

async function seedCountries(): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();

  for (const country of COUNTRIES) {
    const name = check(country.name, `страны ${country.code}`);
    const saved = await prisma.country.upsert({
      where: { code: country.code },
      create: {
        id: country.id,
        code: country.code,
        name: name[DEFAULT_LOCALE],
        isActive: country.isActive,
      },
      update: { name: name[DEFAULT_LOCALE], isActive: country.isActive },
    });

    await writeTranslations(name, (locale, value) =>
      prisma.countryTranslation.upsert({
        where: { countryId_locale: { countryId: saved.id, locale } },
        create: { countryId: saved.id, locale, name: value },
        update: { name: value },
      }),
    );
    byCode.set(country.code, saved.id);
  }

  console.log(`Страны: ${COUNTRIES.length}`);
  return byCode;
}

async function seedLocations(countryIds: Map<string, string>) {
  let districtCount = 0;

  for (const city of CITIES) {
    const cityName = check(city.name, `города ${city.slug}`);
    const countryId = countryIds.get(city.countryCode);
    if (!countryId) {
      throw new Error(
        `Город ${city.slug} ссылается на страну ${city.countryCode}, которой нет в COUNTRIES.`,
      );
    }

    // `City.name` остаётся техническим именем для админки и журналов:
    // показывать его посетителю нельзя — для этого есть переводы.
    const fields = {
      name: cityName[DEFAULT_LOCALE],
      countryId,
      lat: city.lat,
      lng: city.lng,
      isActive: city.isActive,
    };
    const saved = await prisma.city.upsert({
      where: { slug: city.slug },
      create: { id: city.id, slug: city.slug, ...fields },
      update: fields,
    });

    await writeTranslations(cityName, (locale, value) =>
      prisma.cityTranslation.upsert({
        where: { cityId_locale: { cityId: saved.id, locale } },
        create: { cityId: saved.id, locale, name: value },
        update: { name: value },
      }),
    );

    for (const district of city.districts) {
      const districtName = check(district.name, `района ${city.slug}/${district.slug}`);
      const districtFields = {
        name: districtName[DEFAULT_LOCALE],
        lat: district.lat,
        lng: district.lng,
        isActive: district.isActive,
      };

      // Район не удаляем, даже если он выпал из справочника: на него могут
      // ссылаться анкеты, а связь строгая — удаление уронило бы их.
      const savedDistrict = await prisma.district.upsert({
        where: { cityId_slug: { cityId: saved.id, slug: district.slug } },
        create: { id: district.id, slug: district.slug, cityId: saved.id, ...districtFields },
        update: districtFields,
      });

      await writeTranslations(districtName, (locale, value) =>
        prisma.districtTranslation.upsert({
          where: { districtId_locale: { districtId: savedDistrict.id, locale } },
          create: { districtId: savedDistrict.id, locale, name: value },
          update: { name: value },
        }),
      );
      districtCount += 1;
    }
  }

  console.log(`Города: ${CITIES.length}, районов: ${districtCount}`);
}

async function main() {
  await seedServices();
  // Страны первыми: город без страны не сохранить, связь обязательна.
  await seedLocations(await seedCountries());
  console.log(`Справочники готовы (источник: ${referencePath()}).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
