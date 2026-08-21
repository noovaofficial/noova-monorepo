import { type FavoriteItem, favoriteIdsSchema, favoriteItemSchema } from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class FavoritesError extends Error {
  constructor(readonly status: number) {
    super(`Избранное ответило ${status}`);
    this.name = 'FavoritesError';
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { accept: 'application/json', ...init.headers },
    // Избранное всегда от имени пользователя — кука сессии обязательна.
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new FavoritesError(response.status);
  return response;
}

export async function fetchFavoriteIds(): Promise<string[]> {
  const response = await call('/me/favorites/ids');
  return favoriteIdsSchema.parse(await response.json()).ids;
}

export async function fetchFavorites(): Promise<FavoriteItem[]> {
  const response = await call('/me/favorites');
  return z.array(favoriteItemSchema).parse(await response.json());
}

// PUT, а не POST: повторное нажатие должно давать тот же результат, а не
// вторую строку. Тела нет — и заголовка content-type тоже, иначе Fastify
// отвечает «Body cannot be empty when content-type is set».
export async function addFavorite(profileId: string): Promise<void> {
  await call(`/me/favorites/${profileId}`, { method: 'PUT' });
}

export async function removeFavorite(profileId: string): Promise<void> {
  await call(`/me/favorites/${profileId}`, { method: 'DELETE' });
}
