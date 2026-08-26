/**
 * География из админки (N-32). Отдельный модуль, а не часть модерации:
 * доступ сюда только у роли `admin`, и смешивать его с очередью модератора
 * значит однажды выдать лишнее.
 */
import {
  type CityAdmin,
  type CityInput,
  type Country,
  type CountryInput,
  citySchemaAdmin,
  countrySchema,
  type DistrictInput,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class LocationsError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new LocationsError(message, response.status);
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
