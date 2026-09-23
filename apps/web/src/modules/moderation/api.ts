import {
  type AdminAdvertiserAnalytics,
  type AdvertiserKind,
  type AnalyticsPeriod,
  adminAdvertiserAnalyticsSchema,
  type BlockedProfile,
  blockedProfileSchema,
  type CreateStaffInput,
  type GrantTopResult,
  grantTopResultSchema,
  type ManagedUser,
  type ManagedUserDetail,
  type ModeratedProfile,
  type ModerationLogEntry,
  managedUserDetailSchema,
  managedUserSchema,
  moderatedProfileSchema,
  moderationLogEntrySchema,
  type Overview,
  type OverviewQuery,
  overviewSchema,
  type Page,
  pageSchema,
  type QueueCount,
  type QueueItem,
  queueCountSchema,
  queueItemSchema,
  type StaffMember,
  staffMemberSchema,
  type TopNow,
  topNowSchema,
  type UserRole,
  type VerificationRequestDetail,
  type VerificationRequestItem,
  verificationRequestDetailSchema,
  verificationRequestSchema,
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
  kind: 'photo' | 'verification' | 'comment' | 'report' | undefined,
  cursor: string | null = null,
): Promise<Page<QueueItem>> {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return call(`/moderation/queue${qs ? `?${qs}` : ''}`, pageSchema(queueItemSchema));
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

export function fetchBlockedProfiles(cursor: string | null = null): Promise<Page<BlockedProfile>> {
  return call(
    `/moderation/blocked-profiles${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    pageSchema(blockedProfileSchema),
  );
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

export function fetchUsers(
  query?: string,
  blockedOnly = false,
  role?: UserRole,
  cursor: string | null = null,
  advertiserKind?: AdvertiserKind,
): Promise<Page<ManagedUser>> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (query) params.set('query', query);
  // Тип учётной записи: в разделе «Все пользователи» их четыре вида, и без
  // фильтра список превращается в ленту, по которой ищут глазами.
  if (role) params.set('role', role);
  // Раздел People по типу рекламодателя: Agencies/Individuals/Massage salons.
  if (advertiserKind) params.set('advertiserKind', advertiserKind);
  // Заблокированные — отдельная таблица, а не фильтр в поиске: найти
  // конкретного человека и понять, кого заблокировали, — разные задачи.
  if (blockedOnly) params.set('blocked', 'true');
  const qs = params.toString();
  return call(`/moderation/users${qs ? `?${qs}` : ''}`, pageSchema(managedUserSchema));
}

/** Выдача ТОПа анкете без оплаты — только админ. Без `days` — стандартная неделя. */
export function grantProfileTop(id: string, days?: number): Promise<GrantTopResult> {
  return call(`/admin/profiles/${id}/top`, grantTopResultSchema, {
    method: 'POST',
    body: JSON.stringify(days === undefined ? {} : { days }),
  });
}

/** Мгновенное удаление учётки — только админ. 204 без тела. */
export async function deleteUser(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/moderation/users/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new ModerationError(message || 'Не удалось удалить', response.status);
  }
}

/** Удаление одной анкеты — работает и для анкеты агентства. 204 без тела. */
export async function deleteModeratedProfile(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/moderation/profiles/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new ModerationError(message || 'Не удалось удалить', response.status);
  }
}

export function verifyUserEmail(id: string): Promise<ManagedUser> {
  return call(`/moderation/users/${id}/verify-email`, managedUserSchema, { method: 'POST' });
}

/** Аналитика рекламодателя для админа: трафик и деньги. */
export function fetchAdvertiserAnalytics(
  userId: string,
  period: AnalyticsPeriod,
): Promise<AdminAdvertiserAnalytics> {
  return call(
    `/admin/advertisers/${encodeURIComponent(userId)}/analytics?period=${period}`,
    adminAdvertiserAnalyticsSchema,
  );
}

/** Обзор рекламодателей: деньги, типы, таблица (только админ). */
export function fetchOverview(query: OverviewQuery): Promise<Overview> {
  const params = new URLSearchParams({
    period: query.period,
    sort: query.sort,
    dir: query.dir,
    limit: String(query.limit),
    offset: String(query.offset),
  });
  if (query.kind) params.set('kind', query.kind);
  return call(`/admin/overview?${params.toString()}`, overviewSchema);
}

/** Кто сейчас в ТОПе: анкеты и агентства (только админ). */
export function fetchTopNow(): Promise<TopNow> {
  return call('/admin/top-now', topNowSchema);
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
  cursor: string | null = null,
): Promise<Page<ModerationLogEntry>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return call(`/admin/moderation-log${qs ? `?${qs}` : ''}`, pageSchema(moderationLogEntrySchema));
}

export function setStaffBlocked(id: string, blocked: boolean): Promise<StaffMember> {
  return call(`/admin/staff/${id}/block`, staffMemberSchema, {
    method: 'POST',
    body: JSON.stringify({ blocked }),
  });
}

/** Необратимое удаление сотрудника — только админ. 204 без тела. */
export async function deleteStaff(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/admin/staff/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new ModerationError(message || 'Не удалось удалить', response.status);
  }
}

/** Пользователь целиком: тип, подписка, баланс, анкеты. */
export const fetchUserDetail = (id: string): Promise<ManagedUserDetail> =>
  call(`/moderation/users/${id}`, managedUserDetailSchema);

/** Заявки на верификацию личности. Без статуса — ждущие решения. */
export function fetchVerifications(
  status: 'pending' | 'approved' | 'rejected' = 'pending',
  cursor: string | null = null,
): Promise<Page<VerificationRequestItem>> {
  const params = new URLSearchParams({ status });
  if (cursor) params.set('cursor', cursor);
  return call(`/moderation/identity?${params}`, pageSchema(verificationRequestSchema));
}

export const fetchVerification = (id: string): Promise<VerificationRequestDetail> =>
  call(`/moderation/identity/${id}`, verificationRequestDetailSchema);

/** Решения по личности. Имена отличаются от `approveVerification` намеренно:
 *  то — проверка анкеты перед публикацией, это — бейдж (D-12). */
export const approveIdentity = (id: string): Promise<VerificationRequestDetail> =>
  call(`/moderation/identity/${id}/approve`, verificationRequestDetailSchema, {
    method: 'POST',
  });

export const rejectIdentity = (id: string, reason: string): Promise<VerificationRequestDetail> =>
  call(`/moderation/identity/${id}/reject`, verificationRequestDetailSchema, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
