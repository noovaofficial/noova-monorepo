import {
  type AdvertiserKind,
  type BillingConfigInput,
  type CityMonetization,
  type CityMonetizationInput,
  type CityPriceOverrides,
  type CountryMonetization,
  DEFAULT_BILLING_CONFIG,
  emptyCityPriceOverrides,
  type GlobalBillingConfig,
  overlayPrices,
  PLAN_KINDS,
  PLAN_TERMS,
  type PlanKind,
  type PlanTerm,
  type PriceGrid,
  type TopTerms,
} from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/**
 * Монетизация по месту: цены размещения, ТОП анкет и ТОП агентств.
 *
 * Общих значений нет. У страны полный набор, у города — переопределения
 * отдельных ячеек: город сильнее страны, пустое «как в стране». Страна без
 * строк получает набор из payments.md при первом чтении (как и остальная
 * конфигурация монетизации) — но дальше источник только база.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Набор значений новой страны — те же числа, что были общими. */
function defaultCountryMonetization(): CountryMonetization {
  return {
    prices: JSON.parse(JSON.stringify(DEFAULT_BILLING_CONFIG.prices)) as PriceGrid,
    top: {
      weekGc: DEFAULT_BILLING_CONFIG.top.weekGc,
      slots: DEFAULT_BILLING_CONFIG.top.slots,
    },
    agencyTop: { ...DEFAULT_BILLING_CONFIG.agencyTop },
  };
}

/** Заводит стране недостающие строки значениями по умолчанию. Идемпотентно. */
export async function ensureCountryMonetization(db: Db, countryId: string): Promise<void> {
  const defaults = defaultCountryMonetization();
  await db.countryPlacementPrice.createMany({
    data: PLAN_KINDS.flatMap((kind) =>
      PLAN_TERMS.map((term) => ({ countryId, kind, term, gc: defaults.prices[kind][term] })),
    ),
    skipDuplicates: true,
  });
  await db.countryTopSetting.createMany({
    data: [
      {
        countryId,
        weekGc: defaults.top.weekGc,
        slots: defaults.top.slots,
        agencyWeekGc: defaults.agencyTop.weekGc,
        agencySlots: defaults.agencyTop.slots,
      },
    ],
    skipDuplicates: true,
  });
}

export async function getCountryMonetization(
  db: Db,
  countryId: string,
): Promise<CountryMonetization> {
  await ensureCountryMonetization(db, countryId);
  const [rows, top] = await Promise.all([
    db.countryPlacementPrice.findMany({ where: { countryId } }),
    db.countryTopSetting.findUniqueOrThrow({ where: { countryId } }),
  ]);
  const prices = defaultCountryMonetization().prices;
  for (const row of rows) prices[row.kind][row.term] = row.gc;
  return {
    prices,
    top: { weekGc: top.weekGc, slots: top.slots },
    agencyTop: { weekGc: top.agencyWeekGc, slots: top.agencySlots },
  };
}

export async function saveCountryMonetization(
  prisma: PrismaClient,
  countryId: string,
  input: CountryMonetization,
): Promise<CountryMonetization> {
  await prisma.$transaction([
    ...PLAN_KINDS.flatMap((kind) =>
      PLAN_TERMS.map((term) =>
        prisma.countryPlacementPrice.upsert({
          where: { countryId_kind_term: { countryId, kind, term } },
          create: { countryId, kind, term, gc: input.prices[kind][term] },
          update: { gc: input.prices[kind][term] },
        }),
      ),
    ),
    prisma.countryTopSetting.upsert({
      where: { countryId },
      create: {
        countryId,
        weekGc: input.top.weekGc,
        slots: input.top.slots,
        agencyWeekGc: input.agencyTop.weekGc,
        agencySlots: input.agencyTop.slots,
      },
      update: {
        weekGc: input.top.weekGc,
        slots: input.top.slots,
        agencyWeekGc: input.agencyTop.weekGc,
        agencySlots: input.agencyTop.slots,
      },
    }),
  ]);
  return getCountryMonetization(prisma, countryId);
}

async function cityOverrides(db: Db, cityId: string): Promise<CityPriceOverrides> {
  const rows = await db.cityPlacementPrice.findMany({ where: { cityId } });
  const overrides = emptyCityPriceOverrides();
  for (const row of rows)
    (overrides[row.kind] as Record<PlanTerm, number | null>)[row.term] = row.gc;
  return overrides;
}

/** `null`, если города нет. */
export async function getCityMonetization(
  db: Db,
  cityId: string,
): Promise<CityMonetization | null> {
  const city = await db.city.findUnique({
    where: { id: cityId },
    select: { countryId: true, topSetting: { select: { weekGc: true, slots: true } } },
  });
  if (!city) return null;
  const country = await getCountryMonetization(db, city.countryId);
  return {
    prices: await cityOverrides(db, cityId),
    top: { weekGc: city.topSetting?.weekGc ?? null, slots: city.topSetting?.slots ?? null },
    inherited: { prices: country.prices, top: country.top },
  };
}

export async function saveCityMonetization(
  prisma: PrismaClient,
  cityId: string,
  input: CityMonetizationInput,
): Promise<CityMonetization | null> {
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } });
  if (!city) return null;

  const set: { kind: PlanKind; term: PlanTerm; gc: number }[] = [];
  for (const kind of PLAN_KINDS) {
    for (const term of PLAN_TERMS) {
      const gc = input.prices[kind]?.[term];
      if (gc != null) set.push({ kind, term, gc });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.cityPlacementPrice.deleteMany({ where: { cityId } });
    await tx.cityPlacementPrice.createMany({ data: set.map((cell) => ({ cityId, ...cell })) });
    // Оба поля пустые — строка не нужна: город снова живёт по стране.
    if (input.top.weekGc === null && input.top.slots === null) {
      await tx.cityTopSetting.deleteMany({ where: { cityId } });
    } else {
      await tx.cityTopSetting.upsert({
        where: { cityId },
        create: { cityId, weekGc: input.top.weekGc, slots: input.top.slots },
        update: { weekGc: input.top.weekGc, slots: input.top.slots },
      });
    }
  });
  return getCityMonetization(prisma, cityId);
}

/** Сетка цен размещения для места: город → страна. */
export async function resolvePlacementPrices(
  db: Db,
  place: { countryId: string; cityId?: string | null },
): Promise<PriceGrid> {
  const country = await getCountryMonetization(db, place.countryId);
  if (!place.cityId) return country.prices;
  return overlayPrices(country.prices, await cityOverrides(db, place.cityId));
}

/** ТОП агентств страны компании. */
export async function resolveAgencyTop(db: Db, countryId: string): Promise<TopTerms> {
  return (await getCountryMonetization(db, countryId)).agencyTop;
}

/** Страна по умолчанию — для тех, у кого своего места ещё нет. */
export async function defaultCountryId(db: Db): Promise<string | null> {
  const country =
    (await db.country.findFirst({ where: { isDefault: true }, select: { id: true } })) ??
    (await db.country.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    }));
  return country?.id ?? null;
}

export type OwnerPlace = { countryId: string; cityId: string | null };

/**
 * Место, по которому владельцу считается размещение. Агентство — страна
 * аккаунта. Индивидуалка и салон — основной город аккаунта: цена
 * фиксируется в момент покупки, и последующий переезд в другой город не
 * пересчитывает уже купленное. Нет ни анкеты, ни компании — страна по
 * умолчанию. `null`, если в справочнике нет ни одной страны.
 */
export async function ownerPlace(
  db: Db,
  userId: string,
  kind: AdvertiserKind | null,
): Promise<OwnerPlace | null> {
  // Место аккаунта (страна при регистрации, основной город) — главный
  // источник. Ниже — запасной путь для записей, которых миграция не заполнила.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { countryId: true, cityId: true },
  });
  if (user?.countryId) {
    return { countryId: user.countryId, cityId: kind === 'agency' ? null : user.cityId };
  }

  if (kind === 'agency') {
    const company = await db.company.findUnique({
      where: { ownerId: userId },
      select: { countryId: true },
    });
    if (company?.countryId) return { countryId: company.countryId, cityId: null };
  }

  const profile = await db.profile.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
    select: { cityId: true, countryId: true },
  });
  if (profile) return { countryId: profile.countryId, cityId: profile.cityId };

  const fallback = await defaultCountryId(db);
  return fallback ? { countryId: fallback, cityId: null } : null;
}

/**
 * Прайс для места: общие курс и лестница пополнений плюс цены, ТОП и ТОП
 * агентств этого места. Места нет — страна по умолчанию; в справочнике нет
 * ни одной страны — значения из payments.md, чтобы витрина не падала.
 */
export async function buildPriceBook(
  db: Db,
  global: GlobalBillingConfig,
  place: { countryId: string; cityId?: string | null } | null,
): Promise<BillingConfigInput> {
  const countryId = place?.countryId ?? (await defaultCountryId(db));
  if (!countryId) {
    return { ...DEFAULT_BILLING_CONFIG, gcPerEur: global.gcPerEur, topupTiers: global.topupTiers };
  }
  const country = await getCountryMonetization(db, countryId);
  const prices = place?.cityId
    ? overlayPrices(country.prices, await cityOverrides(db, place.cityId))
    : country.prices;
  const cityTop = place?.cityId
    ? await db.cityTopSetting.findUnique({ where: { cityId: place.cityId } })
    : null;
  const slots = cityTop?.slots ?? country.top.slots;
  return {
    gcPerEur: global.gcPerEur,
    topupTiers: global.topupTiers,
    agencyProfileLimit: global.agencyProfileLimit,
    prices,
    top: {
      weekGc: cityTop?.weekGc ?? country.top.weekGc,
      slots,
      shown: Math.min(global.topShown, slots),
    },
    agencyTop: country.agencyTop,
  };
}
