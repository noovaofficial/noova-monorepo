/**
 * Каталог услуг из админки (N-36). Отдельный модуль, как и география:
 * доступ сюда только у роли `admin`.
 *
 * Все мутации возвращают каталог целиком: правка position или группы меняет
 * раскладку остальных, и точечное обновление кэша разошлось бы с сервером.
 */
import {
  type AdminServiceGroup,
  adminServiceGroupSchema,
  type ServiceGroupInput,
  type ServiceInput,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ServiceCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ServiceCatalogError';
  }
}

const listSchema = z.array(adminServiceGroupSchema);

async function call(path: string, init: RequestInit = {}): Promise<AdminServiceGroup[]> {
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
    throw new ServiceCatalogError(message, response.status);
  }

  return listSchema.parse(await response.json());
}

export const fetchCatalog = () => call('/admin/services');

export const createService = (input: ServiceInput) =>
  call('/admin/services', { method: 'POST', body: JSON.stringify(input) });

export const updateService = (id: string, input: Omit<ServiceInput, 'key'>) =>
  call(`/admin/services/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const createGroup = (input: ServiceGroupInput) =>
  call('/admin/service-groups', { method: 'POST', body: JSON.stringify(input) });

export const updateGroup = (key: string, input: Omit<ServiceGroupInput, 'key'>) =>
  call(`/admin/service-groups/${key}`, { method: 'PATCH', body: JSON.stringify(input) });
