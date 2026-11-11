import type { AdvertiserKind } from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { hasVisibleListing } from './listing.js';

/**
 * Правила размещения по месту (страна/город × тип рекламодателя).
 *
 * Два независимых признака: `paid` — нужно ли платное размещение, и
 * `allowed` — можно ли вообще публиковать здесь. Пусто — «не переопределено»:
 * город сильнее страны, страна сильнее значения по умолчанию (платно,
 * разрешено). Каждый признак решается отдельно: город может переопределить
 * только `paid`, оставив `allowed` стране.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type RuleFields = { paid: boolean | null; allowed: boolean | null };

export type Placement = { paid: boolean; allowed: boolean };

export const DEFAULT_PLACEMENT: Placement = { paid: true, allowed: true };

/** Чистое правило приоритета: город → страна → умолчание. */
export function resolvePlacement(
  cityRule: RuleFields | null | undefined,
  countryRule: RuleFields | null | undefined,
): Placement {
  return {
    paid: cityRule?.paid ?? countryRule?.paid ?? DEFAULT_PLACEMENT.paid,
    allowed: cityRule?.allowed ?? countryRule?.allowed ?? DEFAULT_PLACEMENT.allowed,
  };
}

export async function placementFor(
  db: Db,
  place: { cityId: string; countryId: string },
  kind: AdvertiserKind,
): Promise<Placement> {
  // Города всегда наследуют правила страны: переопределения города в базе
  // могут лежать (функционал не вырезан), но не читаются — ровно как и в
  // интерфейсе, где вкладка правил города отключена. Вернуть приоритет
  // города — вернуть сюда запрос по `cityId` и передать его первым аргументом.
  void place.cityId;
  const countryRule = await db.placementRule.findFirst({
    where: { kind, countryId: place.countryId },
    select: { paid: true, allowed: true },
  });
  return resolvePlacement(null, countryRule);
}

export type PublishVerdict = 'ok' | 'forbidden' | 'unpaid';

/**
 * Можно ли публиковать анкету владельца в этом месте. `forbidden` — размещение
 * здесь закрыто для его типа; `unpaid` — место платное, а активного
 * размещения нет. Бесплатное место Listing не требует вовсе.
 */
export async function publishVerdict(
  db: Db,
  owner: { userId: string; kind: AdvertiserKind | null },
  place: { cityId: string; countryId: string },
  options: { paywallEnabled: boolean; hasListing?: boolean },
): Promise<PublishVerdict> {
  // Тип не задан только у не-рекламодателей; для них правил нет.
  const placement = owner.kind ? await placementFor(db, place, owner.kind) : DEFAULT_PLACEMENT;
  if (!placement.allowed) return 'forbidden';
  if (!options.paywallEnabled || !placement.paid) return 'ok';
  const listed = options.hasListing ?? (await hasVisibleListing(db, owner.userId));
  return listed ? 'ok' : 'unpaid';
}
