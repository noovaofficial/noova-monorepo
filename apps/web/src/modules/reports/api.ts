import type { CreateProfileReportInput } from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const responseSchema = z.object({ id: z.string(), isUrgent: z.boolean() });

export class ReportError extends Error {
  constructor(readonly status: number) {
    super(`Жалоба ответила ${status}`);
    this.name = 'ReportError';
  }
}

/**
 * Жалоба на анкету. Вход не требуется, но куку шлём: если человек вошёл,
 * модератор должен видеть, кто пожаловался.
 */
export async function reportProfile(slug: string, input: CreateProfileReportInput) {
  const response = await fetch(`${BASE}/api/v1/profiles/${slug}/reports`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new ReportError(response.status);
  return responseSchema.parse(await response.json());
}
