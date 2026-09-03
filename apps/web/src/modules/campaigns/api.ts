import {
  type Campaign,
  type CampaignInput,
  type CampaignReward,
  campaignRewardSchema,
  campaignSchema,
  type Locale,
  type RedeemError,
  redeemErrorSchema,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CampaignError';
  }
}

/**
 * Отказ по условиям акции — не сбой, а нормальный исход с причиной.
 * Отдельный класс, чтобы кабинет мог показать «квота исчерпана» вместо
 * безликого «не удалось».
 */
export class RedeemRejected extends Error {
  constructor(readonly reason: RedeemError) {
    super(reason);
    this.name = 'RedeemRejected';
  }
}

async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new CampaignError(String(body?.message ?? ''), response.status);
  }

  if (response.status === 204) return schema.parse(null);
  return schema.parse(await response.json());
}

export const fetchCampaigns = (locale: Locale): Promise<Campaign[]> =>
  call(`/admin/campaigns?locale=${locale}`, z.array(campaignSchema));

export const createCampaign = (locale: Locale, input: CampaignInput): Promise<Campaign> =>
  call(`/admin/campaigns?locale=${locale}`, campaignSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateCampaign = (
  locale: Locale,
  id: string,
  input: CampaignInput,
): Promise<Campaign> =>
  call(`/admin/campaigns/${id}?locale=${locale}`, campaignSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteCampaign = (id: string): Promise<null> =>
  call(`/admin/campaigns/${id}`, z.null(), { method: 'DELETE' });

/**
 * Ввод промокода. Отказ по условиям приходит с кодом 409 и причиной —
 * разбираем его здесь, чтобы компонент не знал про коды состояния HTTP.
 */
export async function redeemPromo(code: string): Promise<CampaignReward> {
  const response = await fetch(`${BASE}/api/v1/me/promo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
    credentials: 'include',
    cache: 'no-store',
  });

  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    const parsed = redeemErrorSchema.safeParse(body?.reason);
    throw new RedeemRejected(parsed.success ? parsed.data : 'unknown');
  }

  if (!response.ok) throw new CampaignError('', response.status);

  return campaignRewardSchema.parse(await response.json());
}
