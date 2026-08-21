import {
  type MapCluster,
  mapClusterSchema,
  type Page,
  type ProfileCard,
  pageSchema,
  profileCardSchema,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Подгрузка следующей порции каталога из браузера.
 *
 * Отдельно от `lib/api.ts`: тот ходит с сервера и кэширует ответы, а здесь
 * нужен свежий запрос с текущими фильтрами и курсором.
 */
export async function fetchProfilesClient(
  query: string,
  cursor: string,
): Promise<Page<ProfileCard>> {
  const params = new URLSearchParams(query);
  // Смещение и курсор взаимоисключающи: страница осталась бы прежней.
  params.delete('page');
  params.set('cursor', cursor);
  params.set('limit', '24');

  const response = await fetch(`${BASE}/api/v1/profiles?${params.toString()}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Каталог ответил ${response.status}`);

  return pageSchema(profileCardSchema).parse(await response.json());
}

/**
 * Анкеты на карте — уже сгруппированные по точкам. Отдельно от листинга:
 * карте нужны координаты и минимум подписи, но сразу по всем анкетам.
 */
export async function fetchMapClusters(query: string): Promise<MapCluster[]> {
  const params = new URLSearchParams(query);
  // Страница и курсор к карте отношения не имеют.
  params.delete('page');
  params.delete('cursor');

  const response = await fetch(`${BASE}/api/v1/profiles/map?${params.toString()}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Карта ответила ${response.status}`);

  return z.array(mapClusterSchema).parse(await response.json());
}
