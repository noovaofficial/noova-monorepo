import {
  type ActivateListingResult,
  type AdjustBalanceInput,
  type AdjustBalanceResult,
  activateListingResultSchema,
  adjustBalanceResultSchema,
  type BillingConfigInput,
  type CreateTopupInput,
  type CreateTopupResult,
  createTopupResultSchema,
  currentListingSchema,
  type Listing,
  type PlanTerm,
  type PriceBook,
  priceBookSchema,
  type TopupOrder,
  topupOrderSchema,
  type Wallet,
  walletSchema,
} from '@noova/shared';
import type { z } from 'zod';

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

  return schema.parse(await response.json());
}

/** Прайс для кабинета: пакеты пополнения и цены размещения. */
export const fetchPriceBook = (): Promise<PriceBook> =>
  call('/billing/price-book', priceBookSchema);

/** Конфигурация для админки. Та же форма, что и прайс, — разница в праве записи. */
export const fetchBillingConfig = (): Promise<PriceBook> =>
  call('/admin/billing/config', priceBookSchema);

export const saveBillingConfig = (input: BillingConfigInput): Promise<PriceBook> =>
  call('/admin/billing/config', priceBookSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

/** Баланс и последние операции владельца. */
export const fetchWallet = (): Promise<Wallet> => call('/billing/wallet', walletSchema);

/** Текущее размещение владельца; `null`, пока ни одно не оплачено. */
export const fetchListing = (): Promise<Listing | null> =>
  call('/billing/listing', currentListingSchema).then((result) => result.listing);

/** Ручная корректировка баланса — только админ. */
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
