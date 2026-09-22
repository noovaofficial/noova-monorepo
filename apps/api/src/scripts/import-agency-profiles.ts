/**
 * Разовый импорт анкет агентства из тем же способом, что `seed-reference.ts`
 * заводит справочники, — напрямую в БД и хранилище, а не через публичный API.
 * Общий на все агентства (первым был Escort Lady Luck, вторым — Frankfurt
 * Babes) — то, чем они отличаются (email, тарифы, контакты), задаётся
 * переменными окружения, а не копированием файла под каждое агентство.
 *
 * Через API (`POST /me/profiles/:id/photos`) это упёрлось бы в лимит 40
 * фото/час — на ~400 фото это 10+ часов. Тот лимит защищает от живого
 * пользователя, а не от админского переноса, и здесь ему делать нечего:
 * пишем в БД и объектное хранилище теми же функциями (`processImage`,
 * `putObject`), что использует сама ручка загрузки, — просто без rate-limit
 * плагина Fastify вокруг них.
 *
 * Идемпотентно: у кого анкета с таким slug уже существует — пропускается.
 * Повторный запуск (после сбоя на середине) продолжит с недостающих.
 *
 * draft.json ожидается в ПЛОСКОМ виде (params.age, params.hairColor и т.д. —
 * готовые значения, не {value,raw,needsReview}) — так его оставляет merge.mjs
 * у Lady Luck; для агентств, чей парсер кладёт params под mapped.*.value
 * (как у Frankfurt Babes), сначала прогнать flatten.mjs.
 *
 * Запуск:
 *   на сервере: docker compose exec api sh -c '
 *     AGENCY_EMAIL=agency@example.com \
 *     INPUT_DIR=/app/tmp_scrap_res \
 *     CITY_SLUG=frankfurt \
 *     TELEGRAM_HANDLE=@Handle \
 *     WHATSAPP_NUMBER=+49... \
 *     PRICES="60:20000,120:38000,180:56000,240:74000,360:100000,720:150000,1440:200000" \
 *     node dist/scripts/import-agency-profiles.js'
 *
 * PRICES — "минуты:центы" через запятую, столько слотов, сколько нужно.
 */
import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizeContact } from '@noova/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type {
  AppearanceType,
  BodyType,
  BreastSize,
  BreastType,
  EyeColor,
  HairColor,
  PubicHair,
} from '../generated/prisma/enums.js';
import { buildUniqueSlug } from '../modules/account/slug.js';
import { processImage } from '../modules/photos/images.js';
import { PENDING_PREFIX, putObject } from '../modules/photos/storage.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const AGENCY_EMAIL = process.env.AGENCY_EMAIL;
const INPUT_DIR = process.env.INPUT_DIR;
const PRICES_RAW = process.env.PRICES;
if (!AGENCY_EMAIL || !INPUT_DIR || !PRICES_RAW) {
  console.error(
    'Нужны переменные окружения: AGENCY_EMAIL, INPUT_DIR, PRICES ("минуты:центы,минуты:центы,...")',
  );
  process.exit(1);
}
if (!process.env.TELEGRAM_HANDLE && !process.env.WHATSAPP_NUMBER) {
  console.error('Нужен хотя бы один контакт: TELEGRAM_HANDLE или WHATSAPP_NUMBER.');
  process.exit(1);
}

const CITY_SLUG = process.env.CITY_SLUG ?? 'frankfurt';

const CONTACTS: Array<{ type: 'telegram' | 'whatsapp'; value: string }> = [
  ...(process.env.TELEGRAM_HANDLE ? [{ type: 'telegram' as const, value: process.env.TELEGRAM_HANDLE }] : []),
  ...(process.env.WHATSAPP_NUMBER ? [{ type: 'whatsapp' as const, value: process.env.WHATSAPP_NUMBER }] : []),
];

/** Единые тарифы на весь пакет анкет — приходят через PRICES, не из draft.json.
 *  Инкол и ауткол одинаковы (решение от 2026-09-21, подтверждено для обоих агентств). */
const PRICE_SLOTS = PRICES_RAW.split(',').map((pair) => {
  const [minutesRaw, centsRaw] = pair.split(':');
  const durationMinutes = Number(minutesRaw);
  const cents = Number(centsRaw);
  if (!durationMinutes || !cents) {
    throw new Error(`PRICES: не разобрать "${pair}" — ожидается "минуты:центы"`);
  }
  return { durationMinutes, incallCents: cents, outcallCents: cents };
});
const LOWEST_PRICE_CENTS = Math.min(...PRICE_SLOTS.map((p) => p.incallCents));

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type Draft = {
  name: string;
  bio: string | null;
  params: {
    age: number | null;
    heightCm: number | null;
    weightKg: number | null;
    languages: string[];
    hairColor: HairColor | null;
    eyeColor: EyeColor | null;
    breastSize: BreastSize | null;
    breastType: BreastType | null;
    bodyType: BodyType | null;
    pubicHair: PubicHair | null;
    hasPiercing: boolean | null;
    hasTattoos: boolean | null;
    appearanceType: AppearanceType | null;
    smoker: boolean | null;
  };
  services: Array<{ key: string | null; extra: boolean }>;
};

async function findAgency() {
  const user = await prisma.user.findUnique({
    where: { email: AGENCY_EMAIL },
    select: { id: true, advertiserKind: true, company: { select: { id: true } } },
  });
  if (!user) throw new Error(`Аккаунт ${AGENCY_EMAIL} не найден`);
  if (user.advertiserKind !== 'agency' || !user.company) {
    throw new Error(`${AGENCY_EMAIL} не является агентством (advertiserKind/company)`);
  }
  return { userId: user.id, companyId: user.company.id };
}

async function findCity() {
  const city = await prisma.city.findUnique({
    where: { slug: CITY_SLUG },
    select: { id: true, countryId: true, lat: true, lng: true },
  });
  if (!city) throw new Error(`Город ${CITY_SLUG} не найден в справочнике`);
  return city;
}

async function resolveServiceIds(keys: string[]) {
  if (keys.length === 0) return new Map<string, string>();
  const found = await prisma.service.findMany({
    where: { key: { in: keys } },
    select: { id: true, key: true },
  });
  const missing = keys.filter((k) => !found.some((s) => s.key === k));
  if (missing.length) console.warn(`    услуги не найдены в каталоге, пропущены: ${missing.join(', ')}`);
  return new Map(found.map((s) => [s.key, s.id]));
}

async function uploadPhoto(profileId: string, filePath: string, position: number) {
  const buffer = await readFile(filePath);
  const processed = await processImage(buffer);

  const photo = await prisma.photo.create({
    data: {
      profileId,
      storageKey: '',
      width: processed.width,
      height: processed.height,
      blurDataUrl: processed.blurDataUrl,
      position,
      mimeType: 'image/webp',
      bytes: buffer.byteLength,
      isApproved: false,
    },
    select: { id: true },
  });

  const storageKey = `${PENDING_PREFIX}/${profileId}/${photo.id}`;
  await Promise.all(
    Object.entries(processed.variants).map(([name, variant]) =>
      putObject(`${storageKey}/${name}.webp`, variant.buffer, 'image/webp'),
    ),
  );

  await prisma.photo.update({
    where: { id: photo.id },
    data: {
      storageKey,
      variants: Object.fromEntries(
        Object.entries(processed.variants).map(([name, v]) => [name, { width: v.width, height: v.height }]),
      ),
    },
  });
}

async function importOne(slug: string, agency: { userId: string; companyId: string }, city: Awaited<ReturnType<typeof findCity>>) {
  const dir = path.join(INPUT_DIR!, slug);
  const draft: Draft = JSON.parse(await readFile(path.join(dir, 'draft.json'), 'utf8'));

  const profileSlug = await buildUniqueSlug(prisma, draft.name, CITY_SLUG);
  // Проверяем по displayName+ownerId, не по сгенерированному slug: у него
  // при повторном запуске мог бы отрасти числовой суффикс на пустом месте.
  const existing = await prisma.profile.findFirst({
    where: { ownerId: agency.userId, displayName: draft.name },
    select: { id: true, _count: { select: { photos: true } } },
  });

  let profileId: string;
  if (existing) {
    profileId = existing.id;
    // Фото не трогаем (ниже они и так пропустятся — already === photoFiles.length),
    // но текстовые поля могли поменяться после создания (напр. description
    // убрали 2026-09-21) — обновляем их дешёвым UPDATE без пересоздания анкеты.
    await prisma.profile.update({
      where: { id: existing.id },
      data: { description: draft.bio ?? '', fromPriceCents: LOWEST_PRICE_CENTS },
    });
    // Тарифы — тоже delete+createMany, как в PATCH /me/profiles/:id: тарифы
    // одни на всю пачку и до этого момента у уже созданных анкет не стояли.
    await prisma.priceSlot.deleteMany({ where: { profileId: existing.id } });
    await prisma.priceSlot.createMany({
      data: PRICE_SLOTS.map((s) => ({ ...s, profileId: existing.id })),
    });
    console.log(`  [${slug}] анкета уже есть: ${profileId} (фото: ${existing._count.photos}), описание и тарифы обновлены`);
  } else {
    const p = draft.params;
    const serviceKeys = draft.services.map((s) => s.key).filter((k): k is string => Boolean(k));
    const serviceIdByKey = await resolveServiceIds(serviceKeys);

    // Разные подписи на сайте иногда мапятся на один и тот же ключ каталога
    // (напр. "Дрочит" и "Хэндджоб" — оба на handjob) — без дедупа тут падает
    // уникальный индекс (profileId, serviceId). Оставляем первое вхождение;
    // если хоть одно из дублей помечено "за доплату" — считаем isExtra.
    const serviceCreates = (() => {
      const byServiceId = new Map<string, { serviceId: string; isExtra: boolean }>();
      for (const s of draft.services) {
        if (!s.key) continue;
        const serviceId = serviceIdByKey.get(s.key);
        if (!serviceId) continue;
        const prev = byServiceId.get(serviceId);
        byServiceId.set(serviceId, { serviceId, isExtra: (prev?.isExtra ?? false) || s.extra });
      }
      return [...byServiceId.values()];
    })();

    const created = await prisma.profile.create({
      data: {
        slug: profileSlug,
        kind: 'escort',
        status: 'pending_verification',
        displayName: draft.name,
        description: draft.bio ?? '',
        fromPriceCents: LOWEST_PRICE_CENTS,
        ownerId: agency.userId,
        companyId: agency.companyId,
        cityId: city.id,
        countryId: city.countryId,
        approxLat: city.lat,
        approxLng: city.lng,
        age: p.age,
        heightCm: p.heightCm,
        weightKg: p.weightKg,
        languages: p.languages,
        hairColor: p.hairColor,
        eyeColor: p.eyeColor,
        breastSize: p.breastSize,
        breastType: p.breastType,
        bodyType: p.bodyType,
        pubicHair: p.pubicHair,
        hasPiercing: p.hasPiercing,
        hasTattoos: p.hasTattoos,
        appearanceType: p.appearanceType,
        smoker: p.smoker,
        verification: { create: { status: 'pending', submittedAt: new Date() } },
        services: { create: serviceCreates },
        prices: { create: PRICE_SLOTS },
        contacts: {
          create: CONTACTS.map((c, i) => {
            const norm = normalizeContact(c.type, c.value);
            if (!norm.ok) throw new Error(`Контакт не прошёл нормализацию: ${c.type} ${c.value}`);
            return { type: c.type, value: norm.value, position: i };
          }),
        },
      },
      select: { id: true },
    });
    profileId = created.id;
    console.log(`  [${slug}] анкета создана: ${profileId} (${profileSlug})`);
  }

  const already = existing?._count.photos ?? 0;
  // Файлы вида "._1.jpg" — мусор AppleDouble, который macOS-тар кладёт в
  // архив даже без видимых файлов на диске (com.apple.quarantine и т.п.
  // атрибуты). readdir отсортирует их ПЕРЕД настоящими (точка < цифры),
  // и первая же "фотография" окажется 163-байтным огрызком.
  const photoFiles = (await readdir(path.join(dir, 'photos')))
    .filter((f) => !f.startsWith('.'))
    .sort();
  for (let i = already; i < photoFiles.length; i += 1) {
    await uploadPhoto(profileId, path.join(dir, 'photos', photoFiles[i]!), i);
  }
  if (photoFiles.length > already) {
    console.log(`  [${slug}] фото загружены: ${photoFiles.length - already} новых, всего ${photoFiles.length}`);
  }
}

async function main() {
  const agency = await findAgency();
  const city = await findCity();

  const allSlugs = (await readdir(INPUT_DIR!, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // LIMIT — прогнать на первых N анкетах перед полным пакетом: скрипт ни
  // разу не запускался на настоящей проде, разумно сначала проверить на
  // 1-2 анкетах глазами (в кабинете агентства и в очереди модерации), а не
  // сразу на всех 67.
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
  const slugs = limit ? allSlugs.slice(0, limit) : allSlugs;

  console.log(`Агентство: ${AGENCY_EMAIL} (${agency.userId})`);
  console.log(`Анкет к импорту: ${slugs.length}${limit ? ` (LIMIT=${limit} из ${allSlugs.length})` : ''}`);

  let done = 0;
  for (const slug of slugs) {
    console.log(`\n=== ${slug} ===`);
    try {
      await importOne(slug, agency, city);
      done += 1;
    } catch (err) {
      console.error(`  ОШИБКА [${slug}]:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nГотово: ${done}/${slugs.length}. Все — в статусе pending_verification, ждут модерации.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
