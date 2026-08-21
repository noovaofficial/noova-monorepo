import {
  type CreateCommentInput,
  type OwnComment,
  ownCommentSchema,
  type ReportCommentInput,
} from '@noova/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class CommentError extends Error {
  constructor(readonly status: number) {
    super(`Комментарии ответили ${status}`);
    this.name = 'CommentError';
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new CommentError(response.status);
  return response;
}

/**
 * Свой комментарий к этой анкете — в любом статусе. Отдельно от публичного
 * списка: тот кэшируется страницей, а этот зависит от того, кто смотрит.
 */
export async function fetchOwnComment(slug: string): Promise<OwnComment | null> {
  const response = await call(`/profiles/${slug}/comments/mine`);
  const body = await response.json();
  return body === null ? null : ownCommentSchema.parse(body);
}

export async function createComment(slug: string, input: CreateCommentInput): Promise<OwnComment> {
  const response = await call(`/profiles/${slug}/comments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return ownCommentSchema.parse(await response.json());
}

export async function reportComment(id: string, input: ReportCommentInput): Promise<void> {
  await call(`/comments/${id}/report`, { method: 'POST', body: JSON.stringify(input) });
}
