import {
  type AgencyPaywallInfo,
  type AgencyTariffCandidate,
  type AgencyTariffGrid,
  type AgencyTariffTier,
  type AgencyTariffTierInput,
  type AgencyTariffUpgradeInput,
  type CompanyTariffState,
  candidateTiersFor,
  DEFAULT_BILLING_CONFIG,
  effectiveProfileLimit,
  effectiveTierPriceGc,
  PLAN_TERMS,
  type PlanTerm,
  upgradeCostGc,
} from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/**
 * Тариф агентства по числу анкет (payments.md §3.3, D-13 — заменяет плоский
 * тариф D-07). Сетка — конфигурация, как и остальная монетизация: таблицы
 * заводятся пустыми, значения кладёт первое чтение, а не миграция.
 */

const DEFAULT_TIER_ID = 'default';

type TierRow = Prisma.AgencyTariffTierGetPayload<{ include: { prices: true } }>;

function toTier(row: TierRow): AgencyTariffTier {
  const prices = Object.fromEntries(row.prices.map((price) => [price.term, price.gc])) as Record<
    PlanTerm,
    number
  >;
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    minProfiles: row.minProfiles,
    maxProfiles: row.maxProfiles,
    isDefault: row.isDefault,
    isActive: row.isActive,
    prices,
  };
}

/**
 * Один тариф на всю сетку по умолчанию, дублирующий сегодняшний плоский
 * лимит (D-07), — чтобы деплой не сломал существующие агентства. Бэкфиллит
 * их же в той же транзакции. Идемпотентно: фиксированный id тарифа переживает
 * повторный вызов и параллельные первые чтения.
 */
export async function seedAgencyTariffDefaults(prisma: PrismaClient): Promise<void> {
  const defaults = DEFAULT_BILLING_CONFIG;
  await prisma.$transaction(async (tx) => {
    await tx.agencyTariffTier.upsert({
      where: { id: DEFAULT_TIER_ID },
      create: {
        id: DEFAULT_TIER_ID,
        position: 1,
        name: 'До 8 анкет',
        minProfiles: 1,
        maxProfiles: defaults.agencyProfileLimit,
        isDefault: true,
        isActive: true,
        prices: {
          create: PLAN_TERMS.map((term) => ({ term, gc: defaults.prices.agency[term] })),
        },
      },
      update: {},
    });
    await tx.company.updateMany({
      where: { kind: 'agency', tariffTierId: null },
      data: { tariffTierId: DEFAULT_TIER_ID },
    });
  });
}

export async function loadAgencyTariffGrid(prisma: PrismaClient): Promise<AgencyTariffGrid> {
  const count = await prisma.agencyTariffTier.count();
  if (count === 0) await seedAgencyTariffDefaults(prisma);

  const rows = await prisma.agencyTariffTier.findMany({
    orderBy: { position: 'asc' },
    include: { prices: true },
  });
  return rows.map(toTier);
}

/** Тариф, на который садится новая компания при заведении. Сеет сетку, если
 *  до сих пор пуста — заведение агентства не должно ждать первого чтения
 *  админки. */
export async function resolveDefaultAgencyTierId(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.agencyTariffTier.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  await seedAgencyTariffDefaults(prisma);
  const seeded = await prisma.agencyTariffTier.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (!seeded) throw new Error('Не удалось определить тариф агентства по умолчанию');
  return seeded.id;
}

async function nextPosition(tx: Prisma.TransactionClient): Promise<number> {
  const max = await tx.agencyTariffTier.aggregate({ _max: { position: true } });
  return (max._max.position ?? 0) + 1;
}

/** Ровно один тариф — тариф по умолчанию: выставляя флаг у одного, снимаем
 *  его со всех остальных в той же транзакции. */
async function clearOtherDefaults(tx: Prisma.TransactionClient, exceptId?: string): Promise<void> {
  await tx.agencyTariffTier.updateMany({
    where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createAgencyTariffTier(
  prisma: PrismaClient,
  input: AgencyTariffTierInput,
): Promise<AgencyTariffTier> {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await clearOtherDefaults(tx);
    const position = await nextPosition(tx);
    const created = await tx.agencyTariffTier.create({
      data: {
        position,
        name: input.name,
        minProfiles: input.minProfiles,
        maxProfiles: input.maxProfiles,
        isDefault: input.isDefault,
        isActive: input.isActive,
        prices: { create: PLAN_TERMS.map((term) => ({ term, gc: input.prices[term] })) },
      },
      include: { prices: true },
    });
    return toTier(created);
  });
}

export class TariffTierNotFoundError extends Error {
  constructor() {
    super('Тариф не найден');
    this.name = 'TariffTierNotFoundError';
  }
}

export async function updateAgencyTariffTier(
  prisma: PrismaClient,
  id: string,
  input: AgencyTariffTierInput,
): Promise<AgencyTariffTier> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.agencyTariffTier.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new TariffTierNotFoundError();

    if (input.isDefault) await clearOtherDefaults(tx, id);
    // Цены переписываются целиком: точечное обновление оставило бы срок,
    // удалённый в форме, если бы форма такое допускала.
    await tx.agencyTariffPrice.deleteMany({ where: { tierId: id } });
    const updated = await tx.agencyTariffTier.update({
      where: { id },
      data: {
        name: input.name,
        minProfiles: input.minProfiles,
        maxProfiles: input.maxProfiles,
        isDefault: input.isDefault,
        isActive: input.isActive,
        prices: { create: PLAN_TERMS.map((term) => ({ term, gc: input.prices[term] })) },
      },
      include: { prices: true },
    });
    return toTier(updated);
  });
}

export class TariffTierInUseError extends Error {
  constructor(readonly companyCount: number) {
    super('Тариф назначен агентствам, удалить нельзя');
    this.name = 'TariffTierInUseError';
  }
}

export async function deleteAgencyTariffTier(prisma: PrismaClient, id: string): Promise<void> {
  const companyCount = await prisma.company.count({ where: { tariffTierId: id } });
  if (companyCount > 0) throw new TariffTierInUseError(companyCount);

  const { count } = await prisma.agencyTariffTier.deleteMany({ where: { id } });
  if (count === 0) throw new TariffTierNotFoundError();
}

// --- Тариф и override конкретной компании -----------------------------------

export const companyTariffSelect = {
  id: true,
  ownerId: true,
  name: true,
  customProfileLimit: true,
  customPriceM1Gc: true,
  customPriceM6Gc: true,
  customPriceM12Gc: true,
  tariffTier: { include: { prices: true } },
  // Ниже — для объединённой карточки агентства в модерации, не для тарифа
  // как такового (владелец их же видит в собственном `/me/company/tariff`,
  // просто отражением своих же данных).
  owner: {
    select: {
      email: true,
      emailVerifiedAt: true,
      role: true,
      glowcoinBalance: true,
      createdAt: true,
      lastLoginAt: true,
      locale: true,
    },
  },
  bannedAt: true,
  banReason: true,
  isFeatured: true,
  topPlacement: { select: { status: true, expiresAt: true } },
} satisfies Prisma.CompanySelect;

export type CompanyTariffRow = Prisma.CompanyGetPayload<{ select: typeof companyTariffSelect }>;

export function customPricesOf(row: CompanyTariffRow): Record<PlanTerm, number | null> {
  return { m1: row.customPriceM1Gc, m6: row.customPriceM6Gc, m12: row.customPriceM12Gc };
}

export function tariffOf(row: CompanyTariffRow): AgencyTariffTier | null {
  return row.tariffTier ? toTier(row.tariffTier) : null;
}

export async function presentCompanyTariffState(
  prisma: PrismaClient,
  row: CompanyTariffRow,
  profileCount: number,
): Promise<CompanyTariffState> {
  const candidateTiers = await computeCandidateTiers(prisma, {
    company: row,
    ownerId: row.ownerId,
    existingCount: profileCount,
  });

  const placement = row.topPlacement;
  const topActive =
    placement !== null && placement.status === 'active' && placement.expiresAt > new Date();

  return {
    companyId: row.id,
    companyName: row.name,
    hasCompany: true,
    profileCount,
    tariffTier: tariffOf(row),
    customProfileLimit: row.customProfileLimit,
    customPrices: customPricesOf(row),
    effectiveLimit: effectiveProfileLimit(
      row.tariffTier,
      row.customProfileLimit,
      await fallbackAgencyProfileLimit(prisma),
    ),
    candidateTiers,
    ownerId: row.ownerId,
    ownerEmail: row.owner.email,
    ownerEmailVerified: row.owner.emailVerifiedAt !== null,
    ownerRole: row.owner.role,
    ownerGlowcoinBalance: row.owner.glowcoinBalance,
    ownerCreatedAt: row.owner.createdAt.toISOString(),
    ownerLastLoginAt: row.owner.lastLoginAt?.toISOString() ?? null,
    ownerLocale: row.owner.locale,
    isBanned: row.bannedAt !== null,
    banReason: row.banReason,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    isFeatured: row.isFeatured,
    topExpiresAt: topActive ? placement.expiresAt.toISOString() : null,
  };
}

/**
 * Активное или льготное размещение владельца — на нём считается доплата за
 * повышение тарифа (остаток уже оплаченного периода).
 */
async function currentListingOf(prisma: PrismaClient, ownerId: string) {
  return prisma.listing.findFirst({
    where: { userId: ownerId, status: { in: ['active', 'grace'] } },
    orderBy: { createdAt: 'desc' },
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Длина оплаченного периода и остаток на сейчас — основа кредита при
 *  повышении тарифа. Периода нет — оба нуля, кредита не будет. */
async function listingPeriod(
  prisma: PrismaClient,
  ownerId: string,
): Promise<{ periodDays: number; remainingDays: number }> {
  const listing = await currentListingOf(prisma, ownerId);
  if (!listing) return { periodDays: 0, remainingDays: 0 };
  return {
    periodDays: Math.max(
      1,
      Math.round((listing.expiresAt.getTime() - listing.activatedAt.getTime()) / DAY_MS),
    ),
    remainingDays: Math.max(0, Math.round((listing.expiresAt.getTime() - Date.now()) / DAY_MS)),
  };
}

export async function fallbackAgencyProfileLimit(prisma: PrismaClient): Promise<number> {
  const settings = await prisma.billingSettings.findUnique({ where: { id: 'default' } });
  return settings?.agencyProfileLimit ?? DEFAULT_BILLING_CONFIG.agencyProfileLimit;
}

/** Доплата за переход на конкретный тариф-кандидат по конкретному сроку —
 *  общий расчёт для пейвола и для самостоятельного апгрейда. `company: null` —
 *  агентство ещё не заполнило данные компании (нет ни тарифа, ни override). */
async function upgradeCostFor(
  prisma: PrismaClient,
  params: {
    company: CompanyTariffRow | null;
    ownerId: string;
    targetPriceGc: number;
    term: PlanTerm;
  },
): Promise<number> {
  const { periodDays, remainingDays } = await listingPeriod(prisma, params.ownerId);
  return upgradeCostGc({
    targetPriceGc: params.targetPriceGc,
    currentTermPriceGc: effectiveTierPriceGc(
      params.term,
      params.company ? tariffOf(params.company) : null,
      params.company ? customPricesOf(params.company) : { m1: null, m6: null, m12: null },
      DEFAULT_BILLING_CONFIG.prices.agency[params.term],
    ),
    periodDays,
    remainingDays,
  });
}

/**
 * Доплата за переход на каждый тариф-кандидат, по каждому сроку — то, что
 * увидит агентство и в пейволе, и заранее в своей карточке тарифа. Кандидаты —
 * тарифы, поднимающие потолок выше текущего числа анкет (D-13): переход на
 * тариф не выше нынешнего не имеет смысла здесь, тем занимается ручной
 * override админа.
 */
async function computeCandidateTiers(
  prisma: PrismaClient,
  params: { company: CompanyTariffRow | null; ownerId: string; existingCount: number },
): Promise<AgencyTariffCandidate[]> {
  const { company, ownerId, existingCount } = params;
  const grid = await loadAgencyTariffGrid(prisma);
  const candidates = candidateTiersFor(grid, existingCount);

  return Promise.all(
    candidates.map(async (tier) => ({
      tier,
      upgradeCostGc: Object.fromEntries(
        await Promise.all(
          PLAN_TERMS.map(async (term) => [
            term,
            await upgradeCostFor(prisma, {
              company,
              ownerId,
              targetPriceGc: tier.prices[term],
              term,
            }),
          ]),
        ),
      ) as Record<PlanTerm, number>,
    })),
  );
}

export async function buildAgencyPaywallInfo(
  prisma: PrismaClient,
  params: { company: CompanyTariffRow | null; ownerId: string; existingCount: number },
): Promise<AgencyPaywallInfo> {
  const { company, ownerId, existingCount } = params;
  const effectiveLimit = effectiveProfileLimit(
    company?.tariffTier ?? null,
    company?.customProfileLimit ?? null,
    await fallbackAgencyProfileLimit(prisma),
  );
  const candidateTiers = await computeCandidateTiers(prisma, { company, ownerId, existingCount });

  return {
    currentProfileCount: existingCount,
    effectiveLimit,
    currentTier: company ? tariffOf(company) : null,
    candidateTiers,
  };
}

export class TariffUpgradeNotAllowedError extends Error {
  constructor() {
    super('Выбранный тариф не поднимает лимит выше текущего');
    this.name = 'TariffUpgradeNotAllowedError';
  }
}

/**
 * Самостоятельный апгрейд агентства (payments.md §3.3, D-13): доплата за
 * остаток периода, назначение нового тарифа, сброс индивидуального override —
 * это уже настоящий тариф, а не договорённость сверх сетки.
 */
export async function computeAgencyUpgrade(
  prisma: PrismaClient,
  params: { company: CompanyTariffRow; ownerId: string; input: AgencyTariffUpgradeInput },
): Promise<{ targetTier: AgencyTariffTier; costGc: number }> {
  const grid = await loadAgencyTariffGrid(prisma);
  const targetTier = grid.find((tier) => tier.id === params.input.tierId && tier.isActive);
  if (!targetTier) throw new TariffTierNotFoundError();

  const currentLimit = effectiveProfileLimit(
    params.company.tariffTier,
    params.company.customProfileLimit,
    await fallbackAgencyProfileLimit(prisma),
  );
  if (targetTier.maxProfiles <= currentLimit) throw new TariffUpgradeNotAllowedError();

  const costGc = await upgradeCostFor(prisma, {
    company: params.company,
    ownerId: params.ownerId,
    targetPriceGc: targetTier.prices[params.input.term],
    term: params.input.term,
  });
  return { targetTier, costGc };
}

/**
 * Цена продления размещения для агентства (payments.md §3.3, D-13) — из
 * тарифа, назначенного его компании, с учётом индивидуального override.
 * Раньше здесь была одна цена на всех из общего прайса (D-07) — тариф её
 * заменил везде, а не только в лимите и доплате за апгрейд.
 */
export async function resolveAgencyListingPriceGc(
  prisma: PrismaClient,
  params: { ownerId: string; term: PlanTerm },
): Promise<number> {
  const company = await prisma.company.findUnique({
    where: { ownerId: params.ownerId },
    select: companyTariffSelect,
  });

  return effectiveTierPriceGc(
    params.term,
    company ? tariffOf(company) : null,
    company ? customPricesOf(company) : { m1: null, m6: null, m12: null },
    DEFAULT_BILLING_CONFIG.prices.agency[params.term],
  );
}
