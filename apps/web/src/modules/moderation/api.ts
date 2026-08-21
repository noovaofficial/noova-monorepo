import {
  type BlockedProfile,
  blockedProfileSchema,
  type CreateStaffInput,
  type ManagedUser,
  type ModeratedProfile,
  type ModerationLogEntry,
  managedUserSchema,
  moderatedProfileSchema,
  moderationLogEntrySchema,
  type QueueCount,
  type QueueItem,
  queueCountSchema,
  queueItemSchema,
  type StaffMember,
  staffMemberSchema,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ModerationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ModerationError';
  }
}

async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      // Заголовок только при наличии тела: на POST без тела Fastify отвечает
      // «Body cannot be empty when content-type is set to application/json».
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new ModerationError(message, response.status);
  }

  return schema.parse(await response.json());
}

const ackSchema = z.object({ ok: z.literal(true) });

export function fetchQueueCount(): Promise<QueueCount> {
  return call('/moderation/queue/count', queueCountSchema);
}

export function fetchQueue(
  kind?: 'photo' | 'verification' | 'comment' | 'report',
): Promise<QueueItem[]> {
  return call(`/moderation/queue${kind ? `?kind=${kind}` : ''}`, z.array(queueItemSchema));
}

export function approvePhoto(id: string) {
  return call(`/moderation/photos/${id}/approve`, ackSchema, { method: 'POST' });
}

export function rejectPhoto(id: string, reason: string) {
  return call(`/moderation/photos/${id}/reject`, ackSchema, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function approveVerification(id: string) {
  return call(`/moderation/verifications/${id}/approve`, ackSchema, { method: 'POST' });
}

export function fetchBlockedProfiles(): Promise<BlockedProfile[]> {
  return call('/moderation/blocked-profiles', z.array(blockedProfileSchema));
}

export function blockProfile(id: string, reason: string) {
  return call(`/moderation/profiles/${id}/block`, ackSchema, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function unblockProfile(id: string) {
  return call(`/moderation/profiles/${id}/unblock`, ackSchema, { method: 'POST' });
}

export function blockUser(id: string, reason: string) {
  return call(`/moderation/users/${id}/block`, managedUserSchema, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function unblockUser(id: string) {
  return call(`/moderation/users/${id}/unblock`, managedUserSchema, { method: 'POST' });
}

export function resolveReport(id: string, note?: string) {
  return call(`/moderation/reports/${id}/resolve`, ackSchema, {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
}

export function approveComment(id: string) {
  return call(`/moderation/comments/${id}/approve`, ackSchema, { method: 'POST' });
}

export function rejectComment(id: string, reason: string) {
  return call(`/moderation/comments/${id}/reject`, ackSchema, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function rejectVerification(id: string, reason: string) {
  return call(`/moderation/verifications/${id}/reject`, ackSchema, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function fetchModeratedProfile(id: string): Promise<ModeratedProfile> {
  return call(`/moderation/profiles/${id}`, moderatedProfileSchema);
}

export function fetchUsers(query?: string, blockedOnly = false): Promise<ManagedUser[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  // Заблокированные — отдельная таблица, а не фильтр в поиске: найти
  // конкретного человека и понять, кого заблокировали, — разные задачи.
  if (blockedOnly) params.set('blocked', 'true');
  const qs = params.toString();
  return call(`/moderation/users${qs ? `?${qs}` : ''}`, z.array(managedUserSchema));
}

export function verifyUserEmail(id: string): Promise<ManagedUser> {
  return call(`/moderation/users/${id}/verify-email`, managedUserSchema, { method: 'POST' });
}

export function fetchStaff(): Promise<StaffMember[]> {
  return call('/admin/staff', z.array(staffMemberSchema));
}

export function createStaff(input: CreateStaffInput): Promise<StaffMember> {
  return call('/admin/staff', staffMemberSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type ModerationLogFilters = {
  moderatorId?: string;
  subjectType?: string;
  decision?: string;
};

export function fetchModerationLog(
  filters: ModerationLogFilters = {},
): Promise<ModerationLogEntry[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return call(`/admin/moderation-log${qs ? `?${qs}` : ''}`, z.array(moderationLogEntrySchema));
}

export function setStaffBlocked(id: string, blocked: boolean): Promise<StaffMember> {
  return call(`/admin/staff/${id}/block`, staffMemberSchema, {
    method: 'POST',
    body: JSON.stringify({ blocked }),
  });
}
