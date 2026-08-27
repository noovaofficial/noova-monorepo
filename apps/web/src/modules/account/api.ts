import {
  type CityOption,
  type Company,
  type CompanyInput,
  type CreateProfileInput,
  cityOptionSchema,
  companySchema,
  type Locale,
  type OwnPhoto,
  type OwnProfile,
  ownPhotoSchema,
  ownProfileSchema,
  type ServiceGroup,
  serviceGroupSchema,
  type UpdateProfileInput,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      // Заголовок ставим только когда есть тело: на POST без тела Fastify
      // отвечает «Body cannot be empty when content-type is set to
      // application/json». Под это попадают publish, pause и submit.
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    // Кабинет всегда работает от имени пользователя — куку сессии слать обязательно.
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new AccountError(message, response.status);
  }

  // 204 приходит без тела: `response.json()` на нём падает разбором.
  if (response.status === 204) return schema.parse(null);

  return schema.parse(await response.json());
}

/**
 * Названия городов и услуг приходят из API уже переведёнными (N-35), поэтому
 * язык обязателен: без него сервер отдаёт немецкий по умолчанию, и кабинет
 * на русском показывал бы немецкие подписи.
 */
export function fetchCities(locale: Locale): Promise<CityOption[]> {
  return call(`/cities?locale=${locale}`, z.array(cityOptionSchema));
}

export function fetchServiceCatalog(
  kind: 'escort' | 'massage',
  locale: Locale,
): Promise<ServiceGroup[]> {
  return call(`/services?kind=${kind}&locale=${locale}`, z.array(serviceGroupSchema));
}

/**
 * Компания рекламодателя. `null` — её ещё нет: обычное состояние сразу после
 * регистрации, а не ошибка.
 */
export function fetchOwnCompany(): Promise<Company | null> {
  return call('/me/company', companySchema.nullable());
}

export function saveOwnCompany(input: CompanyInput): Promise<Company> {
  return call('/me/company', companySchema, { method: 'PUT', body: JSON.stringify(input) });
}

/** Привязка анкеты к своей компании — отдельным действием, а не полем формы. */
export function attachProfileToCompany(profileId: string, attached: boolean) {
  return call(`/me/profiles/${profileId}/company`, z.object({ attached: z.boolean() }), {
    method: 'PUT',
    body: JSON.stringify({ attached }),
  });
}

export function fetchOwnProfiles(): Promise<OwnProfile[]> {
  return call('/me/profiles', z.array(ownProfileSchema));
}

export function fetchOwnProfile(id: string): Promise<OwnProfile> {
  return call(`/me/profiles/${id}`, ownProfileSchema);
}

/**
 * Удаление анкеты. Пароль обязателен: действие необратимо, и с угнанной
 * сессией без подтверждения стирают чужой заработок.
 */
export async function deleteProfile(id: string, password: string): Promise<void> {
  await call(`/me/profiles/${id}`, z.null(), {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}

export function createProfile(input: CreateProfileInput): Promise<OwnProfile> {
  return call('/me/profiles', ownProfileSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProfile(id: string, input: UpdateProfileInput): Promise<OwnProfile> {
  return call(`/me/profiles/${id}`, ownProfileSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Загрузка идёт через FormData, поэтому content-type ставит сам браузер —
 * вручную его задавать нельзя, иначе потеряется boundary.
 */
export async function uploadPhoto(profileId: string, file: File): Promise<OwnPhoto> {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${BASE}/api/v1/me/profiles/${profileId}/photos`, {
    method: 'POST',
    body: form,
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new AccountError(message, response.status);
  }

  return ownPhotoSchema.parse(await response.json());
}

export function deletePhoto(profileId: string, photoId: string): Promise<{ ok: true }> {
  return call(`/me/profiles/${profileId}/photos/${photoId}`, z.object({ ok: z.literal(true) }), {
    method: 'DELETE',
  });
}

export function reorderPhotos(profileId: string, ids: string[]): Promise<OwnPhoto[]> {
  return call(`/me/profiles/${profileId}/photos/order`, z.array(ownPhotoSchema), {
    method: 'PATCH',
    body: JSON.stringify({ ids }),
  });
}

export function submitProfile(id: string): Promise<OwnProfile> {
  return call(`/me/profiles/${id}/submit`, ownProfileSchema, { method: 'POST' });
}

export function publishProfile(id: string): Promise<OwnProfile> {
  return call(`/me/profiles/${id}/publish`, ownProfileSchema, { method: 'POST' });
}

export function pauseProfile(id: string): Promise<OwnProfile> {
  return call(`/me/profiles/${id}/pause`, ownProfileSchema, { method: 'POST' });
}
