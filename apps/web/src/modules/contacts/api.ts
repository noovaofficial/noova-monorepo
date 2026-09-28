import { type RevealedContacts, revealedContactsSchema } from '@noova/shared';
import { interactionSignals } from '@/modules/analytics/interaction';
import { getSessionId } from '@/modules/analytics/session';

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
  // Сессия и сигналы взаимодействия — только у анкеты: раскрытие контактов
  // анкеты это ещё и антифрод (фаза 3 аналитики), а у агентства своего
  // журнала событий нет и размечать там нечего.
  return reveal(`/profiles/${slug}/contacts/reveal`, {
    sessionId: getSessionId(),
    ...interactionSignals(),
  });
}

/** То же самое, но для контактов агентства — свой маршрут (см. api/company/reveal.ts). */
export async function revealCompanyContacts(slug: string): Promise<RevealedContacts> {
  return reveal(`/companies/${slug}/contacts/reveal`);
}

async function reveal(path: string, body?: unknown): Promise<RevealedContacts> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      // Заголовка нет, когда тела тоже нет: Fastify на «application/json»
      // без тела отвечает ошибкой.
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Вход не требуется, но если он есть — журнал раскрытий должен это знать.
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) throw new RevealError(response.status);

  return revealedContactsSchema.parse(await response.json());
}
