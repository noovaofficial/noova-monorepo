import {
  type AgencyTopPlacement,
  type AgencyTopState,
  type BuyAgencyTopResult,
  TOP_WEEK_DAYS,
} from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PROFILES_TAG } from '../../plugins/revalidate.js';
import { defaultCountryId, resolveAgencyTop } from './scoped.js';
import { expiryAfterGrant } from './top.js';
import { applyMovement } from './wallet.js';

/**
 * ТОП агентств (payments.md §3.5, D-14): своя таблица мест — зеркало ТОПа
 * анкет (§3.4, `top.ts`), но на `Company`, со своим пулом мест и ценой.
 *
 * Пока место активно, купить его снова нельзя (D-11 — то же правило):
 * недели не складываются, место занимает ровно одну неделю.
 *
 * `Company.isFeatured` — производная: ставится здесь, снимается задачей.
 * По ней собирается оплаченная часть ряда «Агентства» на главной.
 */

const WEEK_MS = TOP_WEEK_DAYS * 24 * 60 * 60 * 1000;

export class AgencyTopFullError extends Error {
  constructor(readonly slots: number) {
    super('Все места в ТОПе агентств заняты');
    this.name = 'AgencyTopFullError';
  }
}

export class AgencyTopAlreadyActiveError extends Error {
  constructor(readonly expiresAt: Date) {
    super('Агентство уже в ТОПе');
    this.name = 'AgencyTopAlreadyActiveError';
  }
}

export class AgencyTopNotActiveError extends Error {
  constructor() {
    super('Агентство сейчас не в ТОПе');
    this.name = 'AgencyTopNotActiveError';
  }
}

export class AgencyTopNoCompanyError extends Error {
  constructor() {
    super('Сначала заведите компанию');
    this.name = 'AgencyTopNoCompanyError';
  }
}

export class AgencyTopNoProfilesError extends Error {
  constructor() {
    super('В ТОП можно поднять только агентство с опубликованной анкетой');
    this.name = 'AgencyTopNoProfilesError';
  }
}

type PlacementRow = {
  companyId: string;
  status: 'active' | 'expired';
  startsAt: Date;
  expiresAt: Date;
};

export function toAgencyTopPlacement(row: PlacementRow): AgencyTopPlacement {
  return {
    companyId: row.companyId,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Пул мест и цена — по стране компании. Страны нет (компания заведена до
 * появления поля и не заполнена миграцией) — страна по умолчанию.
 */
async function poolFor(
  db: Db,
  companyCountryId: string | null,
): Promise<{ countryId: string; weekGc: number; slots: number }> {
  const countryId = companyCountryId ?? (await defaultCountryId(db));
  if (!countryId) throw new AgencyTopNoCompanyError();
  const terms = await resolveAgencyTop(db, countryId);
  return { countryId, ...terms };
}

const takenInCountry = (db: Db, countryId: string, now: Date) =>
  db.agencyTopPlacement.count({ where: { ...activeWhere(now), company: { countryId } } });

/** Занятые места — активные и ещё не истёкшие: задача снимает их с опозданием до цикла. */
const activeWhere = (now: Date) => ({ status: 'active' as const, expiresAt: { gt: now } });

/**
 * Состояние для владельца компании: своей компании может не быть вовсе
 * (кабинет доступен рекламодателю с `advertiserKind: agency` ещё до того,
 * как он её завёл) — тогда `placement` всегда `null`, покупать нечего.
 */
export async function agencyTopState(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<AgencyTopState> {
  const company = await prisma.company.findUnique({
    where: { ownerId: userId },
    select: {
      countryId: true,
      topPlacement: true,
      profiles: { where: { status: 'published' }, select: { id: true }, take: 1 },
    },
  });
  const config = await poolFor(prisma, company?.countryId ?? null);
  const taken = await takenInCountry(prisma, config.countryId, now);
  const placement = company?.topPlacement ?? null;
  const active = placement && placement.status === 'active' && placement.expiresAt > now;

  return {
    priceGc: config.weekGc,
    slots: config.slots,
    freeSlots: Math.max(0, config.slots - taken),
    placement: active ? toAgencyTopPlacement(placement) : null,
    hasPublishedProfile: (company?.profiles.length ?? 0) > 0,
  };
}

export type AgencyTopPurchase = {
  userId: string;
  now?: Date;
};

/**
 * Покупка недели. Та же схема, что у ТОПа анкет: транзакция под замком на
 * строке настроек, иначе два человека одновременно возьмут последнее место.
 */
export function buyAgencyTop(
  prisma: PrismaClient,
  purchase: AgencyTopPurchase,
): Promise<BuyAgencyTopResult> {
  const now = purchase.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BillingSettings" WHERE "id" = 'default' FOR UPDATE`;

    const company = await tx.company.findUnique({
      where: { ownerId: purchase.userId },
      select: {
        id: true,
        countryId: true,
        topPlacement: true,
        profiles: { where: { status: 'published' }, select: { id: true }, take: 1 },
      },
    });
    if (!company) throw new AgencyTopNoCompanyError();
    const pool = await poolFor(tx, company.countryId);
    // Как и у анкеты (D-10): платное место без единой опубликованной анкеты
    // нигде не показалось бы — секция «Агентства» сама фильтрует по этому же
    // условию, и оплата тогда выглядела бы принятой, но бесполезной.
    if (company.profiles.length === 0) throw new AgencyTopNoProfilesError();

    const current = company.topPlacement;
    // Недели не складываются (D-11): пока место активно, вторая покупка отклоняется.
    if (current !== null && current.status === 'active' && current.expiresAt > now) {
      throw new AgencyTopAlreadyActiveError(current.expiresAt);
    }

    const taken = await takenInCountry(tx, pool.countryId, now);
    if (taken >= pool.slots) throw new AgencyTopFullError(pool.slots);

    const spend = await applyMovement(tx, {
      userId: purchase.userId,
      kind: 'TOP',
      gcAmount: -pool.weekGc,
    });

    const expiresAt = new Date(now.getTime() + WEEK_MS);
    const placement = current
      ? await tx.agencyTopPlacement.update({
          where: { companyId: company.id },
          data: { userId: purchase.userId, status: 'active', startsAt: now, expiresAt },
        })
      : await tx.agencyTopPlacement.create({
          data: {
            companyId: company.id,
            userId: purchase.userId,
            status: 'active',
            startsAt: now,
            expiresAt,
          },
        });

    await tx.company.update({ where: { id: company.id }, data: { isFeatured: true } });

    return { placement: toAgencyTopPlacement(placement), ...spend };
  });
}

export type AgencyTopGrant = {
  companyId: string;
  now?: Date;
};

/**
 * Выдача места агентству админом (без оплаты) — та же схема, что у покупки,
 * без `applyMovement`. Место засчитывается на владельца компании.
 *
 * В отличие от платной покупки (`buyAgencyTop`), не требует опубликованной
 * анкеты: там условие защищает от траты GC на место, которое нигде не
 * отобразится (D-10), но выдача бесплатна — тратить нечего, а агентство
 * может обоснованно получить ТОП ещё до публикации анкет (например, по
 * договорённости).
 */
export function grantAgencyTop(
  prisma: PrismaClient,
  grant: AgencyTopGrant,
): Promise<{ placement: AgencyTopPlacement; extended: boolean }> {
  const now = grant.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BillingSettings" WHERE "id" = 'default' FOR UPDATE`;

    const company = await tx.company.findUnique({
      where: { id: grant.companyId },
      select: { id: true, ownerId: true, countryId: true, topPlacement: true },
    });
    if (!company) throw new AgencyTopNoCompanyError();
    const pool = await poolFor(tx, company.countryId);

    const current = company.topPlacement;
    const { expiresAt, extended } = expiryAfterGrant(current, now, WEEK_MS);

    // Продление места, которое уже занято, свободного слота не требует.
    if (!extended) {
      const taken = await takenInCountry(tx, pool.countryId, now);
      if (taken >= pool.slots) throw new AgencyTopFullError(pool.slots);
    }

    const placement = current
      ? await tx.agencyTopPlacement.update({
          where: { companyId: company.id },
          data: extended
            ? { userId: company.ownerId, expiresAt }
            : { userId: company.ownerId, status: 'active', startsAt: now, expiresAt },
        })
      : await tx.agencyTopPlacement.create({
          data: {
            companyId: company.id,
            userId: company.ownerId,
            status: 'active',
            startsAt: now,
            expiresAt,
          },
        });

    await tx.company.update({ where: { id: company.id }, data: { isFeatured: true } });

    return { placement: toAgencyTopPlacement(placement), extended };
  });
}

/** Снятие места у агентства админом — зеркало `revokeTop` для `Company`. */
export async function revokeAgencyTop(
  prisma: PrismaClient,
  companyId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    const placement = await tx.agencyTopPlacement.findUnique({ where: { companyId } });
    if (placement?.status !== 'active' || placement.expiresAt <= now) {
      throw new AgencyTopNotActiveError();
    }
    await tx.agencyTopPlacement.update({ where: { companyId }, data: { status: 'expired' } });
    await tx.company.update({ where: { id: companyId }, data: { isFeatured: false } });
  });
}

/** Задача цикла — расширяет `top-expiry`, а не заводит вторую: истёкшие
 *  места освобождаются, флаг с компаний снимается. */
export async function expireAgencyTopPlacements(
  prisma: PrismaClient,
  options: { now?: Date; revalidate?: (tags: string[]) => void } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const expired = await prisma.agencyTopPlacement.findMany({
    where: { status: 'active', expiresAt: { lte: now } },
    select: { id: true, companyId: true },
  });
  if (expired.length === 0) return 0;

  await prisma.$transaction([
    prisma.agencyTopPlacement.updateMany({
      where: { id: { in: expired.map((row) => row.id) } },
      data: { status: 'expired' },
    }),
    prisma.company.updateMany({
      where: { id: { in: expired.map((row) => row.companyId) } },
      data: { isFeatured: false },
    }),
  ]);

  // Агентства видны на главной под тем же тегом, что и анкеты.
  options.revalidate?.([PROFILES_TAG]);
  return expired.length;
}
