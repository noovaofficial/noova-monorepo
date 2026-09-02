import {
  type Analytics,
  type AnalyticsPeriod,
  analyticsSchema,
  type ContactType,
} from '@noova/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Отчёт кабинета. Только из браузера: страница кабинета приватная и не
 * кэшируется, а серверный рендер ходил бы к API без куки посетителя.
 */
export async function fetchAnalytics(period: AnalyticsPeriod): Promise<Analytics> {
  const response = await fetch(`${BASE}/api/v1/me/analytics?period=${period}`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`Статистика ответила ${response.status}`);

  return analyticsSchema.parse(await response.json());
}

/**
 * Маяки статистики.
 *
 * Ошибку глотаем молча и наружу не отдаём: посетитель пришёл смотреть анкету
 * и звонить, а не помогать нам считать. Сообщение «не удалось отправить
 * статистику» ему нечего делать, а сорванный переход по `tel:` — настоящая
 * потеря для владелицы анкеты.
 */
async function beacon(path: string, body?: unknown): Promise<void> {
  try {
    await fetch(`${BASE}/api/v1${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Вход не требуется, но если он есть — журнал должен это знать: без
      // куки любой отклик считался бы гостевым.
      credentials: 'include',
      cache: 'no-store',
      // Переход по `tel:` или в мессенджер уводит страницу, и обычный fetch
      // браузер при этом отменяет. `keepalive` даёт запросу дожить до отправки
      // — иначе кликов бы просто не было, а именно они и есть отклик.
      keepalive: true,
    });
  } catch {
    // Статистика молчит о своих сбоях: см. выше.
  }
}

export const trackProfileView = (slug: string): Promise<void> => beacon(`/profiles/${slug}/view`);

export const trackContactClick = (slug: string, type: ContactType): Promise<void> =>
  beacon(`/profiles/${slug}/contacts/click`, { type });
