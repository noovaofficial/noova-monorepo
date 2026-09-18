import {
  type ActivateListingResult,
  type AdjustBalanceInput,
  type AdjustBalanceResult,
  type AdjustLimit,
  type AdminBillingConfig,
  type AdminPriceBook,
  type AgencyTariffGrid,
  type AgencyTariffTier,
  type AgencyTariffTierInput,
  type AgencyTopState,
  activateListingResultSchema,
  adjustBalanceResultSchema,
  adjustLimitSchema,
  adminPriceBookSchema,
  agencyTariffGridSchema,
  agencyTariffTierSchema,
  agencyTopStateSchema,
  type BillingOperations,
  type BuyAgencyTopResult,
  type BuyTopResult,
  billingOperationsSchema,
  buyAgencyTopResultSchema,
  buyTopResultSchema,
  type CreateTopupInput,
  type CreateTopupResult,
  createTopupResultSchema,
  currentListingSchema,
  type Listing,
  type PlanTerm,
  type PriceBook,
  priceBookSchema,
  type TopState,
  type TopupOrder,
  topStateSchema,
  topupOrderSchema,
  type Wallet,
  walletSchema,
} from '@noova/shared';
import { z } from 'zod';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BillingError';
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
    throw new BillingError(message || `Запрос ${path} завершился ошибкой`, response.status);
  }

  // 204 приходит без тела: `response.json()` на нём падает разбором.
  if (response.status === 204) return schema.parse(null);

  return schema.parse(await response.json());
}

/** Прайс для кабинета: пакеты пополнения и цены размещения. */
export const fetchPriceBook = (): Promise<PriceBook> =>
  call('/billing/price-book', priceBookSchema);

/**
 * Конфигурация для админки. Шире публичного прайса: сюда входит потолок
 * корректировки для модератора, которому на витрине делать нечего.
 */
export const fetchBillingConfig = (): Promise<AdminPriceBook> =>
  call('/admin/billing/config', adminPriceBookSchema);

export const saveBillingConfig = (input: AdminBillingConfig): Promise<AdminPriceBook> =>
  call('/admin/billing/config', adminPriceBookSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

/** Свой предел корректировки. `null` — предела нет (админ). */
export const fetchAdjustLimit = (): Promise<AdjustLimit> =>
  call('/billing/adjust-limit', adjustLimitSchema);

/** Баланс и последние операции владельца. */
export const fetchWallet = (): Promise<Wallet> => call('/billing/wallet', walletSchema);

/** Текущее размещение владельца; `null`, пока ни одно не оплачено. */
export const fetchListing = (): Promise<Listing | null> =>
  call('/billing/listing', currentListingSchema).then((result) => result.listing);

/** Ручная корректировка баланса. Модератору сервер режет сумму по потолку. */
export const adjustBalance = (input: AdjustBalanceInput): Promise<AdjustBalanceResult> =>
  call('/admin/billing/adjust', adjustBalanceResultSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** Активация или продление размещения на срок. Цену считает сервер. */
export const activateListing = (term: PlanTerm): Promise<ActivateListingResult> =>
  call('/billing/listings', activateListingResultSchema, {
    method: 'POST',
    body: JSON.stringify({ term }),
  });

/** Создаёт заказ у кассы; ответ несёт адрес шлюза, куда уводить человека. */
export const createTopup = (input: CreateTopupInput): Promise<CreateTopupResult> =>
  call('/billing/topups', createTopupResultSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const fetchTopupOrder = (id: string): Promise<TopupOrder> =>
  call(`/billing/topups/${encodeURIComponent(id)}`, topupOrderSchema);

/** Поиск по заказам и движениям — админ. */
export const fetchBillingOperations = (query: string): Promise<BillingOperations> =>
  call(
    `/admin/billing/operations${query ? `?query=${encodeURIComponent(query)}` : ''}`,
    billingOperationsSchema,
  );

/** Журнал за период файлом. Возвращает содержимое — сохранение делает вызывающий. */
export async function downloadTransactionsCsv(from: string, to: string): Promise<Blob> {
  const response = await fetch(
    `${BASE}/api/v1/admin/billing/transactions.csv?from=${from}&to=${to}`,
    { credentials: 'include', cache: 'no-store' },
  );
  if (!response.ok) throw new BillingError('Не удалось выгрузить', response.status);
  return response.blob();
}

/** ТОП: цена, места и свои анкеты в нём. */
export const fetchTopState = (): Promise<TopState> => call('/billing/top', topStateSchema);

/** Неделя в ТОПе для анкеты — покупка или продление. */
export const buyTop = (profileId: string): Promise<BuyTopResult> =>
  call('/billing/top', buyTopResultSchema, {
    method: 'POST',
    body: JSON.stringify({ profileId }),
  });

/** ТОП агентств (payments.md §3.5, D-14): цена, места и своё место в нём. */
export const fetchAgencyTopState = (): Promise<AgencyTopState> =>
  call('/billing/agency-top', agencyTopStateSchema);

/** Неделя в ТОПе для своей компании — покупка или продление. */
export const buyAgencyTop = (): Promise<BuyAgencyTopResult> =>
  call('/billing/agency-top', buyAgencyTopResultSchema, { method: 'POST' });

// --- Тарифы агентств по числу анкет (payments.md §3.3, D-13) ---------------

/** Общая сетка тарифов — по возрастанию `position`. */
export const fetchAgencyTariffGrid = (): Promise<AgencyTariffGrid> =>
  call('/admin/agency-tariffs', agencyTariffGridSchema);

export const createAgencyTariffTier = (input: AgencyTariffTierInput): Promise<AgencyTariffTier> =>
  call('/admin/agency-tariffs', agencyTariffTierSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateAgencyTariffTier = (
  id: string,
  input: AgencyTariffTierInput,
): Promise<AgencyTariffTier> =>
  call(`/admin/agency-tariffs/${id}`, agencyTariffTierSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

/**
 * Удаление тарифа. Сервер отказывает 409-м, если тариф ещё назначен
 * агентствам — компонент показывает это как обычную ошибку сохранения.
 */
export const deleteAgencyTariffTier = (id: string): Promise<null> =>
  call(`/admin/agency-tariffs/${id}`, z.null(), { method: 'DELETE' });
