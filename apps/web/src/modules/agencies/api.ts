import {
  type AgencyTariffUpgradeInput,
  type AgencyTopState,
  agencyTopStateSchema,
  type CompanyTariffOverrideInput,
  type CompanyTariffState,
  companyTariffStateSchema,
  type GrantAgencyTopResult,
  grantAgencyTopResultSchema,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class AgencyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AgencyError';
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
    const message = await response
      .json()
      .then((body) => String(body?.message ?? ''))
      .catch(() => '');
    throw new AgencyError(message || `Запрос ${path} завершился ошибкой`, response.status);
  }

  return schema.parse(await response.json());
}

export const fetchCompanyTariff = (id: string): Promise<CompanyTariffState> =>
  call(`/admin/companies/${id}/tariff`, companyTariffStateSchema);

export const saveCompanyTariff = (
  id: string,
  input: CompanyTariffOverrideInput,
): Promise<CompanyTariffState> =>
  call(`/admin/companies/${id}/tariff`, companyTariffStateSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

/** Свой тариф — агентство смотрит, сколько анкет уже есть и сколько входит. */
export const fetchOwnCompanyTariff = (): Promise<CompanyTariffState> =>
  call('/me/company/tariff', companyTariffStateSchema);

export const upgradeOwnCompanyTariff = (
  input: AgencyTariffUpgradeInput,
): Promise<CompanyTariffState> =>
  call('/me/company/tariff/upgrade', companyTariffStateSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** Состояние ТОПа конкретного агентства для карточки в модерации. */
export const fetchCompanyTop = (companyId: string): Promise<AgencyTopState> =>
  call(`/admin/companies/${companyId}/top`, agencyTopStateSchema);

/** Выдача ТОПа агентству без оплаты — только админ. */
export const grantCompanyTop = (companyId: string): Promise<GrantAgencyTopResult> =>
  call(`/admin/companies/${companyId}/top`, grantAgencyTopResultSchema, { method: 'POST' });

const ackSchema = z.object({ ok: z.literal(true) });

/** Блокировка агентства — независимо от `isActive`, которым распоряжается
 *  сам владелец. Каскадом банит анкеты компании. */
export const blockCompany = (companyId: string, reason: string) =>
  call(`/moderation/companies/${companyId}/block`, ackSchema, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const unblockCompany = (companyId: string) =>
  call(`/moderation/companies/${companyId}/unblock`, ackSchema, { method: 'POST' });
