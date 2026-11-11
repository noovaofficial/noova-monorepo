import type { AdvertiserKind } from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { placementFor } from '../billing/placement.js';
import { withCode } from './country-lock.js';

/**
 * Место аккаунта рекламодателя: страна выбирается при регистрации и меняется
 * в настройках; основной город подставляется в новые анкеты и определяет цену
 * размещения индивидуалки и салона. У агентства город необязателен.
 */

export const PLACEMENT_FORBIDDEN = 'placement_forbidden';
export const LOCATION_HAS_PROFILES = 'location_has_profiles';

export type LocationProblem =
  | 'country_not_found'
  | 'city_required'
  | 'city_not_found'
  | 'placement_forbidden';

type CountryRow = { id: string; isActive: boolean } | null;
type CityRow = { id: string; countryId: string; isActive: boolean } | null;

/** Чистое решение: можно ли такое место для этого типа рекламодателя. */
export function locationProblem(input: {
  kind: AdvertiserKind;
  country: CountryRow;
  city: CityRow;
  citySlug: string | null | undefined;
  allowed: boolean;
}): LocationProblem | null {
  const { kind, country, city, citySlug, allowed } = input;
  if (!country?.isActive) return 'country_not_found';
  if (!citySlug) return kind === 'agency' ? null : 'city_required';
  if (!city?.isActive || city.countryId !== country.id) return 'city_not_found';
  return allowed ? null : 'placement_forbidden';
}

export type ResolvedLocation = { countryId: string; cityId: string | null };

/**
 * Загружает страну и город и решает. Правила размещения читаются по стране
 * (города их наследуют), поэтому закрытая страна запрещает и регистрацию, и
 * смену места на неё.
 */
export async function resolveAccountLocation(
  prisma: PrismaClient,
  input: { kind: AdvertiserKind; countryCode: string; citySlug: string | null | undefined },
): Promise<{ location: ResolvedLocation } | { problem: LocationProblem }> {
  const country = await prisma.country.findUnique({
    where: { code: input.countryCode.toUpperCase() },
    select: { id: true, isActive: true },
  });
  const city = input.citySlug
    ? await prisma.city.findUnique({
        where: { slug: input.citySlug },
        select: { id: true, countryId: true, isActive: true },
      })
    : null;
  const allowed = country
    ? (await placementFor(prisma, { cityId: city?.id ?? '', countryId: country.id }, input.kind))
        .allowed
    : false;

  const problem = locationProblem({
    kind: input.kind,
    country,
    city,
    citySlug: input.citySlug,
    allowed,
  });
  if (problem || !country) return { problem: problem ?? 'country_not_found' };
  return { location: { countryId: country.id, cityId: city?.id ?? null } };
}

/** Ошибка HTTP по причине — с кодом, по которому интерфейс подбирает перевод. */
export function throwLocationProblem(fastify: FastifyInstance, problem: LocationProblem): never {
  switch (problem) {
    case 'placement_forbidden':
      throw withCode(
        fastify.httpErrors.forbidden('Размещение для этого типа в выбранной стране недоступно'),
        PLACEMENT_FORBIDDEN,
      );
    case 'city_required':
      throw withCode(fastify.httpErrors.badRequest('Выберите город'), 'city_required');
    case 'city_not_found':
      throw withCode(
        fastify.httpErrors.badRequest('Город не найден в выбранной стране'),
        'city_not_found',
      );
    default:
      throw withCode(fastify.httpErrors.badRequest('Страна не найдена'), 'country_not_found');
  }
}
