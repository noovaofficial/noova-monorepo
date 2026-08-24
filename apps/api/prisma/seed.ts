/**
 * Демо-данные: перенос генераторов-заглушек из documentation/prototypes/noova_home.html
 * в БД, чтобы фронт работал против настоящего API, а не массивов в разметке.
 * Фото по-прежнему отсутствуют — карточки рендерят градиентный плейсхолдер.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { CITIES, type CitySeed } from './locations.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан — сид выполнять некуда.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/** Владелец всех демо-анкет. По нему же сид находит, что убирать за собой. */
const DEMO_OWNER_EMAIL = 'demo-advertiser@noova.local';

/**
 * Районы с координатами центра. Точность намеренно грубая — до района:
 * из этих значений собирается `Profile.approxLat/Lng`, и ничего точнее
 * система о местоположении не знает.
 */
// Города и районы — общий справочник: он же накатывается на прод.
const BERLIN: CitySeed =
  CITIES.find((c) => c.slug === 'berlin') ??
  (() => {
    throw new Error('В справочнике prisma/locations.ts нет Берлина.');
  })();

const NAMES = [
  'Alisa',
  'Maya',
  'Lena',
  'Sofia',
  'Nika',
  'Daria',
  'Emma',
  'Karina',
  'Julia',
  'Vera',
  'Lisa',
  'Marta',
  'Nina',
  'Kira',
  'Eva',
  'Polina',
  'Rita',
  'Zoya',
  'Anya',
  'Tanya',
];

const SALONS = [
  'Lotus Spa',
  'Aurora',
  'Velvet Rooms',
  'Orchid',
  'Silber',
  'Nirvana',
  'Amber',
  'Oasis',
  'Lumière',
  'Perle',
];

// Справочник услуг наполняется отдельным сидом (prisma/seed-services.ts):
// он живёт дольше демо-данных и накатывается на прод. Здесь только выбираем
// из уже существующего.
// Параметры внешности раскладываются по кругу, чтобы в демо-данных нашлось
// хоть что-то под любой фильтр — иначе панель выглядит нерабочей.
const HAIR = ['blonde', 'brunette', 'black', 'red', 'brown'] as const;
const EYES = ['blue', 'green', 'brown', 'grey', 'hazel'] as const;
const BODY = ['slim', 'thin', 'athletic', 'normal', 'curvy'] as const;
const BUST = ['a', 'b', 'c', 'd', 'e'] as const;
const LOOK = ['european', 'asian', 'latin', 'african', 'arab', 'mixed'] as const;
const PUBIC = ['natural', 'trimmed', 'shaved'] as const;

const ESCORT_SERVICE_SETS = [
  ['dinner_date', 'events', 'incall', 'sex_classic'],
  ['travel_companion', 'overnight', 'outcall', 'sex_classic', 'kissing'],
  ['dinner_date', 'photoshoot', 'hotel_visit', 'massage_erotic'],
  ['travel_abroad', 'events', 'incall', 'outcall', 'sex_classic'],
  ['massage_classic', 'massage_relaxing', 'incall', 'striptease_pro'],
];

const SALON_SERVICE_SETS = [
  ['massage_classic', 'massage_professional', 'massage_table'],
  ['massage_relaxing', 'massage_erotic', 'incall'],
  ['massage_professional', 'massage_couples', 'massage_table'],
  ['massage_classic', 'massage_urological', 'incall'],
];

function slugify(value: string, suffix: number): string {
  const base = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-berlin-${suffix}`;
}

/**
 * Демо-контакты. Номера из диапазона 015700000xx — он зарезервирован BNetzA
 * под примеры и не принадлежит живому абоненту: сид с настоящим номером
 * означал бы звонки постороннему человеку.
 */
function demoContacts(index: number) {
  const number = `+4915700000${String(index % 100).padStart(2, '0')}`;
  return [
    { type: 'phone' as const, value: number, position: 0 },
    { type: 'whatsapp' as const, value: number, position: 1 },
    ...(index % 2 === 0
      ? [{ type: 'telegram' as const, value: `@noova_demo_${index}`, position: 2 }]
      : []),
    ...(index % 3 === 0 ? [{ type: 'viber' as const, value: number, position: 3 }] : []),
  ];
}

async function main() {
  // Чистим только то, что создаёт этот сид. Раньше здесь стояло
  // `user.deleteMany()` без условий — оно сносило и живые учётные записи
  // вместе с их анкетами. На локальной машине это стоило потерянного аккаунта,
  // на стенде с тестировщиками стоило бы куда дороже.
  console.log('Сид: очистка демо-данных…');

  const demo = await prisma.user.findUnique({
    where: { email: DEMO_OWNER_EMAIL },
    select: { id: true },
  });

  if (demo) {
    // Каскады в схеме сами уберут фото, тарифы, услуги и заявки на верификацию.
    await prisma.profile.deleteMany({ where: { ownerId: demo.id } });
  }
  await prisma.promoSlot.deleteMany({ where: { profileId: null } });

  const owner = await prisma.user.upsert({
    where: { email: DEMO_OWNER_EMAIL },
    update: { advertiserKind: 'individual' },
    create: {
      email: DEMO_OWNER_EMAIL,
      // Демо-аккаунт без рабочего пароля: войти через него нельзя.
      passwordHash: 'seed-placeholder-not-a-valid-hash',
      role: 'advertiser',
      advertiserKind: 'individual',
      isAdult: true,
    },
  });

  // Города, районы и услуги демо-сид больше не заводит: это справочники,
  // и заводить их в двух местах значит однажды получить разные названия
  // на стенде и на проде. Здесь только читаем — и падаем, если справочник
  // не накачен, вместо того чтобы молча создать «свой» Берлин без переводов.
  const berlin = await prisma.city.findUnique({ where: { slug: BERLIN.slug } });
  if (!berlin) {
    console.error('Справочник пуст. Сначала: pnpm --filter @noova/api db:seed:reference');
    process.exit(1);
  }

  const districts = await prisma.district.findMany({ where: { cityId: berlin.id } });
  if (districts.length === 0) {
    console.error(`У города ${BERLIN.slug} нет районов. Сначала: db:seed:reference`);
    process.exit(1);
  }

  const services = await prisma.service.findMany({ select: { id: true, key: true } });
  if (services.length === 0) {
    console.error('Справочник услуг пуст. Сначала: pnpm --filter @noova/api db:seed:services');
    process.exit(1);
  }
  const serviceIdByKey = new Map(services.map((s) => [s.key, s.id]));

  const linkServices = (keys: string[]) => ({
    create: keys
      .map((key) => serviceIdByKey.get(key))
      .filter((id): id is string => Boolean(id))
      .map((serviceId, index) => ({ serviceId, isExtra: index > 2 })),
  });

  const now = Date.now();

  console.log('Сид: анкеты…');
  for (let i = 0; i < 45; i += 1) {
    const name = NAMES[i % NAMES.length]!;
    const district = districts[i % districts.length]!;
    const fromPriceCents = (150 + (i % 8) * 20) * 100;
    const isFeatured = i % 5 === 0;
    const isOnline = i % 3 === 0;

    await prisma.profile.create({
      data: {
        slug: slugify(name, i + 1),
        kind: 'escort',
        status: 'published',
        displayName: name,
        description:
          'Демо-описание анкеты. Реальный текст появляется после прохождения верификации.',
        ownerId: owner.id,
        cityId: berlin.id,
        districtId: district.id,
        // Координаты берём из района, а не выдумываем: иначе точка на карте
        // не совпадает с подписанным районом — ровно это и было раньше.
        approxLat: district.lat,
        approxLng: district.lng,
        fromPriceCents,
        isFeatured,
        isVerified: true,
        age: 21 + ((i * 7) % 14),
        heightCm: 160 + (i % 20),
        weightKg: 50 + (i % 15),
        hairColor: HAIR[i % HAIR.length]!,
        eyeColor: EYES[i % EYES.length]!,
        bodyType: BODY[i % BODY.length]!,
        breastSize: BUST[i % BUST.length]!,
        breastType: i % 3 === 0 ? 'silicone' : 'natural',
        pubicHair: PUBIC[i % PUBIC.length]!,
        appearanceType: LOOK[i % LOOK.length]!,
        hasPiercing: i % 4 === 0,
        hasTattoos: i % 3 === 0,
        languages: ['de', 'en', ...(i % 3 === 0 ? ['ru'] : [])],
        tags: [],
        lastSeenAt: isOnline ? new Date(now - 60_000) : new Date(now - 6 * 60 * 60 * 1000),
        publishedAt: new Date(now - i * 3_600_000),
        prices: {
          create: [
            {
              durationMinutes: 60,
              incallCents: fromPriceCents,
              outcallCents: fromPriceCents + 5000,
            },
            {
              durationMinutes: 120,
              incallCents: fromPriceCents * 2 - 3000,
              outcallCents: fromPriceCents * 2 + 2000,
            },
            {
              durationMinutes: 720,
              incallCents: fromPriceCents * 7,
              outcallCents: fromPriceCents * 8,
            },
          ],
        },
        services: linkServices(ESCORT_SERVICE_SETS[i % ESCORT_SERVICE_SETS.length]!),
        contacts: { create: demoContacts(i) },
        verification: {
          create: {
            status: 'verified',
            ageConfirmed: true,
            identityConfirmed: true,
            submittedAt: new Date(now - 10 * 86_400_000),
            reviewedAt: new Date(now - 9 * 86_400_000),
          },
        },
      },
    });
  }

  console.log('Сид: массажные салоны…');
  for (let i = 0; i < 30; i += 1) {
    const name = SALONS[i % SALONS.length]!;
    const district = districts[(i + 2) % districts.length]!;
    const fromPriceCents = (60 + (i % 6) * 15) * 100;

    await prisma.profile.create({
      data: {
        slug: slugify(name, i + 1),
        kind: 'massage',
        status: 'published',
        displayName: name,
        description: 'Демо-описание салона.',
        ownerId: owner.id,
        cityId: berlin.id,
        districtId: district.id,
        fromPriceCents,
        isFeatured: i % 6 === 0,
        isVerified: true,
        languages: ['de', 'en'],
        tags: [],
        publishedAt: new Date(now - i * 7_200_000),
        services: linkServices(SALON_SERVICE_SETS[i % SALON_SERVICE_SETS.length]!),
        contacts: { create: demoContacts(i + 50) },
        prices: {
          create: [
            { durationMinutes: 60, incallCents: fromPriceCents, outcallCents: null },
            { durationMinutes: 120, incallCents: fromPriceCents * 2 - 1000, outcallCents: null },
          ],
        },
        verification: {
          create: {
            status: 'verified',
            ageConfirmed: true,
            identityConfirmed: true,
            reviewedAt: new Date(now - 5 * 86_400_000),
          },
        },
      },
    });
  }

  console.log('Сид: промо-слоты…');
  const featured = await prisma.profile.findMany({
    where: { isFeatured: true, kind: 'escort' },
    take: 6,
    select: { id: true, slug: true, displayName: true, district: { select: { name: true } } },
  });

  await Promise.all(
    featured.map((p, idx) =>
      prisma.promoSlot.create({
        data: {
          profileId: p.id,
          title: p.displayName,
          subtitle: `Berlin · ${p.district?.name ?? 'Mitte'}`,
          href: `/profile/${p.slug}`,
          position: idx,
        },
      }),
    ),
  );

  const counts = await prisma.profile.groupBy({ by: ['kind'], _count: true });
  console.log('Готово:', counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
