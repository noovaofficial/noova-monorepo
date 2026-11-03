/**
 * География из админки (N-32). Отдельный модуль, а не часть модерации:
 * доступ сюда только у роли `admin`, и смешивать его с очередью модератора
 * значит однажды выдать лишнее.
 */
import {
  type CityAdmin,
  type CityInput,
  type CityMonetization,
  type CityMonetizationInput,
  type Country,
  type CountryInput,
  type CountryMonetization,
  cityMonetizationSchema,
  citySchemaAdmin,
  countryMonetizationSchema,
  countrySchema,
  type DistrictInput,
  type PlacementRule,
  type PlacementRuleInput,
  placementRuleSchema,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class LocationsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Код причины от сервера — по нему интерфейс подбирает перевод. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'LocationsError';
  }
}

async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new LocationsError(
      String(body?.message ?? ''),
      response.status,
      typeof body?.code === 'string' ? body.code : undefined,
    );
  }

  return schema.parse(await response.json());
}

export function fetchCountries(): Promise<Country[]> {
  return call('/admin/countries', z.array(countrySchema));
}

export function createCountry(input: CountryInput): Promise<Country> {
  return call('/admin/countries', countrySchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCountry(id: string, input: Omit<CountryInput, 'code'>): Promise<Country> {
  return call(`/admin/countries/${id}`, countrySchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function fetchPlacementRules(): Promise<PlacementRule[]> {
  return call('/admin/placement-rules', z.array(placementRuleSchema));
}

export function savePlacementRule(input: PlacementRuleInput): Promise<PlacementRule[]> {
  return call('/admin/placement-rules', z.array(placementRuleSchema), {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function fetchCities(countryId?: string): Promise<CityAdmin[]> {
  const qs = countryId ? `?countryId=${encodeURIComponent(countryId)}` : '';
  return call(`/admin/cities${qs}`, z.array(citySchemaAdmin));
}

export function createCity(input: CityInput): Promise<CityAdmin> {
  return call('/admin/cities', citySchemaAdmin, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCity(id: string, input: Omit<CityInput, 'districts' | 'slug'>) {
  return call(`/admin/cities/${id}`, citySchemaAdmin, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function addDistrict(cityId: string, input: DistrictInput): Promise<CityAdmin> {
  return call(`/admin/cities/${cityId}/districts`, citySchemaAdmin, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateDistrict(id: string, input: Omit<DistrictInput, 'slug'>): Promise<CityAdmin> {
  return call(`/admin/districts/${id}`, citySchemaAdmin, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// --- Монетизация: цены размещения, ТОП ------------------------------------

export function fetchCountryMonetization(countryId: string): Promise<CountryMonetization> {
  return call(`/admin/countries/${countryId}/monetization`, countryMonetizationSchema);
}

export function saveCountryMonetization(
  countryId: string,
  input: CountryMonetization,
): Promise<CountryMonetization> {
  return call(`/admin/countries/${countryId}/monetization`, countryMonetizationSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function fetchCityMonetization(cityId: string): Promise<CityMonetization> {
  return call(`/admin/cities/${cityId}/monetization`, cityMonetizationSchema);
}

export function saveCityMonetization(
  cityId: string,
  input: CityMonetizationInput,
): Promise<CityMonetization> {
  return call(`/admin/cities/${cityId}/monetization`, cityMonetizationSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
