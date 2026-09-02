import { z } from 'zod';
import { type AdvertiserKind, advertiserKindSchema } from './account';
import { LOCALES } from './locales';

/**
 * Контракт монетизации (payments.md §2, §3, §5).
 *
 * Прайс и бонусная лестница — конфигурация, а не константы: курс, пороги и
 * цены меняются из админки без выката. Здесь лежат форма этой конфигурации,
 * формула начисления и значения по умолчанию из документа — те, которыми
 * заполняются пустые таблицы при первом чтении.
 */

/** Тип размещения совпадает с типом рекламодателя: тариф не выбирают
 *  отдельно от того, кем зарегистрировались. */
export const planKindSchema = advertiserKindSchema;
export type PlanKind = AdvertiserKind;
/** Порядок в интерфейсе — по возрастанию цены. */
export const PLAN_KINDS: PlanKind[] = ['individual', 'salon', 'agency'];

export const planTermSchema = z.enum(['m1', 'm6', 'm12']);
export type PlanTerm = z.infer<typeof planTermSchema>;
/** Порядок сроков — от короткого к длинному. */
export const PLAN_TERMS: PlanTerm[] = ['m1', 'm6', 'm12'];
export const TERM_MONTHS: Record<PlanTerm, number> = { m1: 1, m6: 6, m12: 12 };

const gcPriceSchema = z.number().int().positive().max(1_000_000);

/** Все типы и все сроки обязательны: дырка в сетке — это тариф без цены. */
export const priceGridSchema = z.record(planKindSchema, z.record(planTermSchema, gcPriceSchema));
export type PriceGrid = z.infer<typeof priceGridSchema>;

export const topupTierInputSchema = z.object({
  eur: z.number().int().positive().max(100_000),
  /** Целые проценты: так лестница читается и правится без дробей. */
  bonusPercent: z.number().int().min(0).max(500),
});
export type TopupTierInput = z.infer<typeof topupTierInputSchema>;

/**
 * Пороги идут строго по возрастанию. Два одинаковых или перепутанные —
 * это лестница, по которой сервер не сможет однозначно выбрать бонус.
 */
const isAscending = (tiers: TopupTierInput[]): boolean =>
  tiers.every((tier, i) => i === 0 || tier.eur > (tiers[i - 1] as TopupTierInput).eur);

export const billingConfigInputSchema = z.object({
  /** Витринный курс: сколько GC за 1 €. Реальная цена ниже за счёт бонуса. */
  gcPerEur: z.number().positive().max(10_000),
  prices: priceGridSchema,
  topupTiers: z
    .array(topupTierInputSchema)
    .min(1)
    .max(12)
    .refine(isAscending, { message: 'Пороги пополнения должны идти по возрастанию' }),
  /** Сколько анкет входит в тариф агентства. Потолок, не порог доплаты (D-07). */
  agencyProfileLimit: z.number().int().min(1).max(100),
});
export type BillingConfigInput = z.infer<typeof billingConfigInputSchema>;

/**
 * Начисление за пополнение (payments.md §2.1): `eur × курс × (1 + бонус)`.
 * Считается, а не хранится: иначе в таблице можно было бы сохранить
 * лестницу, где начисление не сходится с курсом и бонусом.
 */
export function grantedGc(eur: number, bonusPercent: number, gcPerEur: number): number {
  return Math.round(eur * gcPerEur * (1 + bonusPercent / 100));
}

export const topupTierSchema = topupTierInputSchema.extend({
  grantedGc: z.number().int().nonnegative(),
});
export type TopupTier = z.infer<typeof topupTierSchema>;

/** Прайс, каким его видят кабинет и витрина: конфигурация плюс начисления. */
export const priceBookSchema = billingConfigInputSchema.extend({
  topupTiers: z.array(topupTierSchema),
});
export type PriceBook = z.infer<typeof priceBookSchema>;

export function toPriceBook(config: BillingConfigInput): PriceBook {
  return {
    ...config,
    topupTiers: config.topupTiers.map((tier) => ({
      ...tier,
      grantedGc: grantedGc(tier.eur, tier.bonusPercent, config.gcPerEur),
    })),
  };
}

/** €-эквивалент по витринному курсу — справочный «стикер» рядом с GC (§6). */
export function gcToEur(gc: number, gcPerEur: number): number {
  return gc / gcPerEur;
}

/**
 * Значения из payments.md. Ими заполняются пустые таблицы при первом чтении
 * конфигурации; после этого источник — база, и сюда правки не возвращаются.
 */
export const DEFAULT_BILLING_CONFIG: BillingConfigInput = {
  gcPerEur: 10,
  prices: {
    individual: { m1: 170, m6: 690, m12: 990 },
    salon: { m1: 490, m6: 1990, m12: 2990 },
    agency: { m1: 990, m6: 3990, m12: 5990 },
  },
  topupTiers: [
    { eur: 10, bonusPercent: 0 },
    { eur: 25, bonusPercent: 10 },
    { eur: 50, bonusPercent: 20 },
    { eur: 100, bonusPercent: 30 },
    { eur: 200, bonusPercent: 40 },
    { eur: 300, bonusPercent: 50 },
  ],
  agencyProfileLimit: 8,
};

// --- Кошелёк и журнал (payments.md §5, этап 2) -----------------------------

export const billingTransactionKindSchema = z.enum(['TOPUP', 'SPEND', 'RENEWAL', 'ADJUSTMENT']);
export type BillingTransactionKind = z.infer<typeof billingTransactionKindSchema>;

/** Запись журнала, как её видит владелец кошелька. Поставщика и оператора нет:
 *  это служебные поля разбора, а не часть истории для человека. */
export const billingTransactionSchema = z.object({
  id: z.string(),
  kind: billingTransactionKindSchema,
  /** Знак — направление: + пополнение, − списание. */
  gcAmount: z.number().int(),
  eurPaidCents: z.number().int().nullable(),
  bonusPercent: z.number().int().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type BillingTransaction = z.infer<typeof billingTransactionSchema>;

export const walletSchema = z.object({
  balanceGc: z.number().int().nonnegative(),
  transactions: z.array(billingTransactionSchema),
});
export type Wallet = z.infer<typeof walletSchema>;

export const listingStatusSchema = z.enum(['active', 'grace', 'expired', 'pending_topup']);
export type ListingStatus = z.infer<typeof listingStatusSchema>;

export const listingSchema = z.object({
  id: z.string(),
  kind: planKindSchema,
  term: planTermSchema,
  status: listingStatusSchema,
  activatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  /** Конец льготных дней (D-04): до этого момента анкеты ещё в выдаче. */
  graceEndsAt: z.string().datetime(),
});
export type Listing = z.infer<typeof listingSchema>;

/** Обёртка, а не `nullable()` на верхнем уровне: пустой ответ — это `{ listing: null }`. */
export const currentListingSchema = z.object({ listing: listingSchema.nullable() });

/** Верхняя граница разовой корректировки — защита от лишнего нуля в поле. */
export const GC_ADJUST_LIMIT = 1_000_000;

/**
 * Ручная корректировка баланса администратором (`ADJUSTMENT`). Причина
 * обязательна: запись без неё через месяц никому ничего не объяснит.
 */
export const adjustBalanceInputSchema = z.object({
  userId: z.string().min(1),
  gcAmount: z
    .number()
    .int()
    .min(-GC_ADJUST_LIMIT)
    .max(GC_ADJUST_LIMIT)
    .refine((value) => value !== 0, { message: 'Сумма не может быть нулевой' }),
  note: z.string().trim().min(3).max(500),
});
export type AdjustBalanceInput = z.infer<typeof adjustBalanceInputSchema>;

export const adjustBalanceResultSchema = z.object({
  balanceGc: z.number().int().nonnegative(),
  transaction: billingTransactionSchema,
});
export type AdjustBalanceResult = z.infer<typeof adjustBalanceResultSchema>;

// --- Активация размещения (payments.md §4, этап 3) ---------------------------

/** Тип размещения не выбирают: он совпадает с типом учётной записи. */
export const activateListingInputSchema = z.object({ term: planTermSchema });
export type ActivateListingInput = z.infer<typeof activateListingInputSchema>;

/** Что показать после списания: размещение, остаток и запись журнала (§6). */
export const activateListingResultSchema = z.object({
  listing: listingSchema,
  balanceGc: z.number().int().nonnegative(),
  transaction: billingTransactionSchema,
});
export type ActivateListingResult = z.infer<typeof activateListingResultSchema>;

// --- Пополнение через кассу (payments.md §4, этап 4) --------------------------

export const topupOrderStatusSchema = z.enum([
  'created',
  'pending',
  'paid',
  'expired',
  'canceled',
  'failed',
]);
export type TopupOrderStatus = z.infer<typeof topupOrderStatusSchema>;

/** Заказ, каким его видит владелец: сумма, что начислится, и состояние. */
export const topupOrderSchema = z.object({
  id: z.string(),
  eurCents: z.number().int().positive(),
  grantedGc: z.number().int().positive(),
  bonusPercent: z.number().int().nonnegative(),
  status: topupOrderStatusSchema,
  createdAt: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
});
export type TopupOrder = z.infer<typeof topupOrderSchema>;

/** Сумма — только из лестницы; язык нужен для адреса возврата с кассы. */
export const createTopupInputSchema = z.object({
  eur: z.number().int().positive().max(100_000),
  locale: z.enum(LOCALES),
});
export type CreateTopupInput = z.infer<typeof createTopupInputSchema>;

export const createTopupResultSchema = z.object({
  order: topupOrderSchema,
  paymentUrl: z.string().url(),
});
export type CreateTopupResult = z.infer<typeof createTopupResultSchema>;
