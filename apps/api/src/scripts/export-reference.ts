/**
 * Выгрузка справочников из базы в `prisma/reference-data.ts` (N-32).
 *
 * Зачем. Города, районы и услуги заводятся из админки — значит живут в базе,
 * а не в коде. Полное обнуление сервера стёрло бы их вместе со всем
 * остальным. Выгрузка возвращает их в репозиторий: файл коммитится, и на
 * чистой машине `db:seed:reference` восстанавливает справочник целиком.
 *
 *   pnpm --filter @noova/api db:export:reference
 *   docker compose exec api node dist/scripts/export-reference.js   # на сервере
 *
 * Идентификаторы выгружаются вместе с данными и проставляются при создании.
 * Без этого восстановленный справочник получил бы новые id, и всё, что на
 * него ссылается — анкеты из отдельного дампа, ссылки в журналах, — указывало
 * бы в пустоту.
 *
 * Порядок записей детерминированный: файл лежит в git, и перестановка строк
 * от запуска к запуску превращала бы каждый diff в нечитаемый.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { LOCALES, type Translated } from '@noova/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { referencePath } from '../reference-data.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Путь тот же, что у загрузчика: файл читается в рантайме, а не импортируется.
const OUT = referencePath();

const gaps: string[] = [];

/**
 * Переводы из строк в объект.
 *
 * У показываемой посетителю записи неполный перевод — ошибка, и выгрузка
 * останавливается: записать в файл половину названия значит закрепить
 * дефект в репозитории.
 *
 * Исключение — отключённые записи (`soft`). Каталог услуг менялся, и от
 * прежних версий остались деактивированные строки без переводов. Выкинуть
 * их нельзя: на них могут ссылаться анкеты, а восстановление справочника без
 * них уронило бы внешние ключи. Подставляем ключ и предупреждаем.
 */
function names(rows: { locale: string; name: string }[], what: string, soft?: string): Translated {
  const byLocale = new Map(rows.map((r) => [r.locale, r.name]));
  const missing = LOCALES.filter((locale) => !byLocale.get(locale));

  if (missing.length > 0) {
    if (soft === undefined) {
      throw new Error(`У ${what} нет перевода на ${missing.join(', ')}. Выгрузка остановлена.`);
    }
    gaps.push(`${what}: нет ${missing.join(', ')}`);
    return Object.fromEntries(LOCALES.map((l) => [l, byLocale.get(l) ?? soft])) as Translated;
  }

  return Object.fromEntries(LOCALES.map((l) => [l, byLocale.get(l)])) as Translated;
}

async function main() {
  const countries = await prisma.country.findMany({
    orderBy: { code: 'asc' },
    include: { translations: true },
  });
  const cities = await prisma.city.findMany({
    orderBy: { slug: 'asc' },
    include: {
      country: { select: { code: true } },
      translations: true,
      districts: { orderBy: { slug: 'asc' }, include: { translations: true } },
    },
  });
  const services = await prisma.service.findMany({
    orderBy: [{ position: 'asc' }, { key: 'asc' }],
    include: { translations: true },
  });
  const groupRows = await prisma.serviceGroupTranslation.findMany({
    orderBy: { groupKey: 'asc' },
  });

  // Порядок групп — по первой услуге группы: он и определяет вид панели
  // фильтров, а алфавит перемешал бы её.
  //
  // Только по активным: группа, в которой остались одни отключённые услуги
  // прежних версий каталога, — не раздел интерфейса, а след истории.
  // Сами услуги при этом выгружаются, чтобы не потерять их id.
  const groupOrder: string[] = [];
  for (const service of services) {
    if (!service.isActive) continue;
    if (!groupOrder.includes(service.group)) groupOrder.push(service.group);
  }
  const groupsByKey = new Map<string, typeof groupRows>();
  for (const row of groupRows) {
    const list = groupsByKey.get(row.groupKey) ?? [];
    list.push(row);
    groupsByKey.set(row.groupKey, list);
  }

  const data = {
    countries: countries.map((c) => ({
      id: c.id,
      code: c.code,
      name: names(c.translations, `страны ${c.code}`),
      isActive: c.isActive,
    })),
    cities: cities.map((city) => ({
      id: city.id,
      slug: city.slug,
      name: names(city.translations, `города ${city.slug}`),
      countryCode: city.country.code,
      lat: city.lat ?? 0,
      lng: city.lng ?? 0,
      isActive: city.isActive,
      districts: city.districts.map((d) => ({
        id: d.id,
        slug: d.slug,
        name: names(d.translations, `района ${city.slug}/${d.slug}`),
        lat: d.lat ?? 0,
        lng: d.lng ?? 0,
        isActive: d.isActive,
      })),
    })),
    serviceGroups: groupOrder.map((key) => ({
      key,
      name: names(groupsByKey.get(key) ?? [], `группы ${key}`, key),
    })),
    services: services.map((s) => ({
      id: s.id,
      key: s.key,
      group: s.group,
      appliesTo: s.appliesTo,
      position: s.position,
      isActive: s.isActive,
      name: names(s.translations, `услуги ${s.key}`, s.isActive ? undefined : s.key),
    })),
  };

  // JSON с отступами и переводом строки в конце: файл лежит в git, и diff
  // должен читаться построчно, а не одной длинной строкой.
  writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(
    `Выгружено: стран ${countries.length}, городов ${cities.length}, районов ${cities.reduce((n, c) => n + c.districts.length, 0)}, услуг ${services.length}, групп ${groupOrder.length}`,
  );
  console.log(`→ ${OUT}`);

  if (gaps.length > 0) {
    console.warn(`\nБез полного перевода (подставлен ключ), ${gaps.length}:`);
    for (const gap of gaps) console.warn(`  · ${gap}`);
    console.warn('Это отключённые записи прежних версий каталога. Они выгружены,');
    console.warn('чтобы не потерять их id: на них могут ссылаться анкеты.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
