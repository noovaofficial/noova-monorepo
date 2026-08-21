import {
  type Page,
  type ProfileCard,
  type ProfileComment,
  type ProfileDetail,
  type ProfileQuery,
  type PromoSlot,
  pageSchema,
  profileCardSchema,
  profileCommentSchema,
  profileDetailSchema,
  promoSlotSchema,
} from '@noova/shared';
import { z } from 'zod';

/**
 * На сервере ходим по внутреннему адресу контейнера, в браузере — по публичному.
 * Одна переменная на оба случая не годится: внутри docker-сети localhost — это сам контейнер.
 */
const SERVER_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const BROWSER_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const baseUrl = () => (typeof window === 'undefined' ? SERVER_BASE : BROWSER_BASE);

/**
 * Секрет, которым серверный рендер представляется API, чтобы не расходовать
 * лимит запросов одного посетителя: весь рендер идёт с одного адреса.
 * Переменная без префикса NEXT_PUBLIC_ — в браузерный бандл она не попадает,
 * и это здесь главное свойство, а не деталь именования.
 */
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? '';

const internalHeaders = (): Record<string, string> =>
  typeof window === 'undefined' && INTERNAL_TOKEN !== ''
    ? { 'x-noova-internal': INTERNAL_TOKEN }
    : {};

/**
 * В разработке ответы API не кэшируем. ISR нужен в проде, а локально он только
 * мешает: правка на бэке или в контракте не видна до истечения revalidate,
 * и это выглядит как поломка фронта, а не как устаревший кэш.
 */
const isProduction = process.env.NODE_ENV === 'production';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchOptions = {
  /** Секунды жизни кэша Next. 0 — всегда свежие данные. */
  revalidate?: number;
  tags?: string[];
  signal?: AbortSignal;
};

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: FetchOptions = {},
): Promise<T> {
  const url = `${baseUrl()}/api/v1${path}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...internalHeaders() },
    signal: options.signal,
    ...(isProduction
      ? {
          next: {
            revalidate: options.revalidate ?? 60,
            ...(options.tags ? { tags: options.tags } : {}),
          },
        }
      : { cache: 'no-store' as const }),
  });

  if (!response.ok) {
    throw new ApiError(`Запрос ${path} завершился ошибкой`, response.status);
  }

  // Валидируем ответ схемой из @noova/shared: рассинхрон контракта с бэком
  // должен падать здесь, а не превращаться в undefined глубоко в разметке.
  return schema.parse(await response.json());
}

function toSearchParams(query: Partial<ProfileQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Общий тег всех листингов: публикация или снятие анкеты меняет любой из них. */
export const PROFILES_TAG = 'profiles';

export function fetchProfiles(
  query: Partial<ProfileQuery> = {},
  options?: FetchOptions,
): Promise<Page<ProfileCard>> {
  return request(`/profiles${toSearchParams(query)}`, pageSchema(profileCardSchema), {
    tags: [PROFILES_TAG],
    ...options,
  });
}

export function fetchProfileCount(
  query: Partial<ProfileQuery> = {},
  options?: FetchOptions,
): Promise<{ total: number }> {
  return request(`/profiles/count${toSearchParams(query)}`, z.object({ total: z.number() }), {
    tags: [PROFILES_TAG],
    ...options,
  });
}

export function fetchProfile(slug: string, options?: FetchOptions): Promise<ProfileDetail> {
  return request(`/profiles/${slug}`, profileDetailSchema, {
    tags: [`profile:${slug}`],
    ...options,
  });
}

/**
 * Опубликованные комментарии к анкете. Тянем на сервере вместе со страницей:
 * это содержимое, которое должно попадать в индекс и быть видимым без JS.
 * Личное — свой неопубликованный комментарий — приходит отдельно из браузера.
 */
export function fetchComments(slug: string, options?: FetchOptions): Promise<ProfileComment[]> {
  return request(`/profiles/${slug}/comments`, z.array(profileCommentSchema), {
    tags: [`profile:${slug}`],
    ...options,
  });
}

export function fetchNearby(
  slug: string,
  limit = 8,
  options?: FetchOptions,
): Promise<ProfileCard[]> {
  return request(`/profiles/${slug}/nearby?limit=${limit}`, z.array(profileCardSchema), {
    tags: [PROFILES_TAG],
    ...options,
  });
}

/**
 * Обёртка для некритичных данных: возвращает запасное значение, если API
 * недоступен. Нужна в двух местах — при сборке образа (бэкенда тогда ещё нет,
 * а страницы пререндерятся) и при аварии API в проде: каталог должен
 * отрисоваться пустым, а не отдать 500. ISR подтянет данные на следующем цикле.
 */
export async function safely<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[api] ${label} недоступен, отдаём запасное значение`, error);
    return fallback;
  }
}

/** Справочник услуг для панели фильтров. Тот же эндпоинт, что и в кабинете,
 *  но запрашивается с сервера и кэшируется вместе со страницей. */
export function fetchServiceCatalogPublic(
  kind: 'escort' | 'massage',
  options?: FetchOptions,
): Promise<{ group: string; services: { key: string; group: string }[] }[]> {
  return request(
    `/services?kind=${kind}`,
    z.array(
      z.object({
        group: z.string(),
        services: z.array(z.object({ key: z.string(), group: z.string() })),
      }),
    ),
    options,
  );
}

export function fetchPromo(city?: string, options?: FetchOptions): Promise<PromoSlot[]> {
  const qs = city ? `?city=${encodeURIComponent(city)}` : '';
  return request(`/promo${qs}`, z.array(promoSlotSchema), options);
}
