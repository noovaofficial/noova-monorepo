import {
  type CurrentUser,
  currentUserSchema,
  type DeleteAccountInput,
  type LoginInput,
  type RegisterInput,
} from '@noova/shared';

/**
 * Отдельный клиент от `lib/api.ts`: тот кэширует ответы и ходит с сервера,
 * а здесь всё строго из браузера, без кэша и с передачей куки сессии.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type ApiIssue = { field?: string; code?: string };

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Разбор ошибок валидации по полям, если сервер его прислал. */
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function post<T>(path: string, body: unknown, schema?: { parse: (v: unknown) => T }) {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    // Тело здесь всегда есть (минимум `{}`), поэтому заголовок безусловен.
    // Если появится POST без тела — заголовок ставить нельзя, Fastify его
    // отвергнет: «Body cannot be empty when content-type is application/json».
    headers: { 'content-type': 'application/json' },
    // Без этого браузер не примет и не отправит куку сессии на другой origin.
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Тело ошибки может быть не-JSON (например, при отказе прокси) — тогда
    // просто нет разбора по полям, но сам код ответа всё равно осмысленный.
    const issues = await response
      .json()
      .then((body) => (Array.isArray(body?.issues) ? (body.issues as ApiIssue[]) : []))
      .catch(() => [] as ApiIssue[]);
    throw new AuthError(`Запрос ${path} завершился ошибкой`, response.status, issues);
  }

  const json = await response.json();
  return schema ? schema.parse(json) : (json as T);
}

export function login(input: LoginInput): Promise<CurrentUser> {
  return post('/auth/login', input, currentUserSchema);
}

export function register(input: RegisterInput): Promise<{ ok: true }> {
  return post('/auth/register', input);
}

export function requestPasswordReset(email: string): Promise<{ ok: true }> {
  return post('/auth/password-reset/request', { email });
}

export function confirmPasswordReset(token: string, password: string): Promise<{ ok: true }> {
  return post('/auth/password-reset/confirm', { token, password });
}

export function verifyEmail(token: string): Promise<{ ok: true }> {
  return post('/auth/verify-email', { token });
}

export function requestAccountDeletion(input: DeleteAccountInput): Promise<CurrentUser> {
  return post('/auth/delete-account', input, currentUserSchema);
}

export function cancelAccountDeletion(): Promise<CurrentUser> {
  // Тело пустое, но не отсутствует: `post` всегда ставит content-type.
  return post('/auth/delete-account/cancel', {}, currentUserSchema);
}

export function logout(): Promise<{ ok: true }> {
  return post('/auth/logout', {});
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch(`${BASE}/api/v1/auth/me`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new AuthError('Не удалось получить пользователя', response.status);
  return currentUserSchema.parse(await response.json());
}

/** Переводит HTTP-код в ключ словаря: тексты ошибок приходят из i18n, не с бэка. */
export function errorKeyFor(error: unknown): string {
  if (!(error instanceof AuthError)) return 'errorGeneric';
  switch (error.status) {
    case 401:
      return 'errorInvalidCredentials';
    case 403:
      return 'errorBanned';
    case 409:
      return 'errorNicknameTaken';
    case 429:
      return 'errorRateLimited';
    default:
      return 'errorGeneric';
  }
}
