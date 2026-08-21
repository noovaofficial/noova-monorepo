import { type RevealedContacts, revealedContactsSchema } from '@noova/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class RevealError extends Error {
  constructor(readonly status: number) {
    super(`Раскрытие контактов ответило ${status}`);
    this.name = 'RevealError';
  }
}

/**
 * Раскрытие контактов — только из браузера и только по явному действию.
 * Функция намеренно не живёт в `lib/api.ts`: тот вызывается при рендере на
 * сервере и кэширует ответы, а здесь и то и другое недопустимо — контакты
 * попали бы в HTML страницы, ради чего весь гейт и затевался.
 */
export async function revealContacts(slug: string): Promise<RevealedContacts> {
  const response = await fetch(`${BASE}/api/v1/profiles/${slug}/contacts/reveal`, {
    method: 'POST',
    // Заголовка content-type нет намеренно: тела у запроса тоже нет, а Fastify
    // на «application/json» без тела отвечает ошибкой.
    headers: { accept: 'application/json' },
    // Вход не требуется, но если он есть — журнал раскрытий должен это знать.
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) throw new RevealError(response.status);

  return revealedContactsSchema.parse(await response.json());
}
