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
 * Идемпотентно, но односторонне: заводит то, чего в базе ещё нет, и не
 * трогает то, что уже есть. Раньше повторный запуск обновлял существующие
 * записи целиком, включая `isActive`, — и как только страны, города, районы
 * и услуги стали редактироваться из админки (N-32/N-35), это превратилось в
 * баг: администратор отключает город, а на следующем `make deploy` тот снова
 * включается, потому что в `reference-data.json` он всё ещё активен. Правки
 * из админки теперь для этого шага неприкосновенны — он лишь досоздаёт
 * недостающее на чистой или пополняемой базе.
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
  let createdGroups = 0;
  for (const group of SERVICE_GROUPS) {
    const existing = await prisma.serviceGroupTranslation.findFirst({
      where: { groupKey: group.key },
    });
    if (existing) continue;

    const name = check(group.name, `группы ${group.key}`);
    await writeTranslations(name, (locale, value) =>
      prisma.serviceGroupTranslation.create({ data: { groupKey: group.key, locale, name: value } }),
    );
    createdGroups += 1;
  }

  let createdServices = 0;
  for (const service of SERVICES) {
    const existing = await prisma.service.findUnique({ where: { key: service.key } });
    if (existing) continue;

    const name = check(service.name, `услуги ${service.key}`);
    // Ищем по ключу, а id проставляем только при создании: на чистой машине
    // справочник получит те же идентификаторы, что в выгрузке, а на машине,
    // где запись уже есть со своим id, ничего не сломается.
    const saved = await prisma.service.create({
      data: {
        id: service.id,
        key: service.key,
        group: service.group,
        appliesTo: service.appliesTo,
        position: service.position,
        isActive: service.isActive,
      },
    });

    await writeTranslations(name, (locale, value) =>
      prisma.serviceTranslation.create({ data: { serviceId: saved.id, locale, name: value } }),
    );
    createdServices += 1;
  }

  console.log(
    `Услуги: ${SERVICES.length} в справочнике, новых заведено — групп ${createdGroups}, услуг ${createdServices}`,
  );
}

async function seedCountries(): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();
  let createdCount = 0;

  for (const country of COUNTRIES) {
    const existing = await prisma.country.findUnique({ where: { code: country.code } });
    if (existing) {
      byCode.set(country.code, existing.id);
      continue;
    }

    const name = check(country.name, `страны ${country.code}`);
    const saved = await prisma.country.create({
      data: {
        id: country.id,
        code: country.code,
        name: name[DEFAULT_LOCALE],
        isActive: country.isActive,
      },
    });

    await writeTranslations(name, (locale, value) =>
      prisma.countryTranslation.create({ data: { countryId: saved.id, locale, name: value } }),
    );
    byCode.set(country.code, saved.id);
    createdCount += 1;
  }

  console.log(`Страны: ${COUNTRIES.length} в справочнике, новых заведено ${createdCount}`);
  return byCode;
}

async function seedLocations(countryIds: Map<string, string>) {
  let createdCities = 0;
  let createdDistricts = 0;

  for (const city of CITIES) {
    let cityId: string;
    const existingCity = await prisma.city.findUnique({ where: { slug: city.slug } });

    if (existingCity) {
      cityId = existingCity.id;
    } else {
      const cityName = check(city.name, `города ${city.slug}`);
      const countryId = countryIds.get(city.countryCode);
      if (!countryId) {
        throw new Error(
          `Город ${city.slug} ссылается на страну ${city.countryCode}, которой нет в COUNTRIES.`,
        );
      }

      // `City.name` остаётся техническим именем для админки и журналов:
      // показывать его посетителю нельзя — для этого есть переводы.
      const saved = await prisma.city.create({
        data: {
          id: city.id,
          slug: city.slug,
          name: cityName[DEFAULT_LOCALE],
          countryId,
          lat: city.lat,
          lng: city.lng,
          isActive: city.isActive,
        },
      });

      await writeTranslations(cityName, (locale, value) =>
        prisma.cityTranslation.create({ data: { cityId: saved.id, locale, name: value } }),
      );
      cityId = saved.id;
      createdCities += 1;
    }

    for (const district of city.districts) {
      const existingDistrict = await prisma.district.findUnique({
        where: { cityId_slug: { cityId, slug: district.slug } },
      });
      if (existingDistrict) continue;

      const districtName = check(district.name, `района ${city.slug}/${district.slug}`);
      const savedDistrict = await prisma.district.create({
        data: {
          id: district.id,
          slug: district.slug,
          cityId,
          name: districtName[DEFAULT_LOCALE],
          lat: district.lat,
          lng: district.lng,
          isActive: district.isActive,
        },
      });

      await writeTranslations(districtName, (locale, value) =>
        prisma.districtTranslation.create({
          data: { districtId: savedDistrict.id, locale, name: value },
        }),
      );
      createdDistricts += 1;
    }
  }

  console.log(
    `Города: ${CITIES.length} в справочнике, новых заведено ${createdCities}, новых районов ${createdDistricts}`,
  );
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
