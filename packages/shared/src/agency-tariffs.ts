import { z } from 'zod';
import { userRoleSchema } from './auth';
import { gcPriceSchema, type PlanTerm, planTermSchema } from './billing';
import { profileSummarySchema } from './moderation';

/**
 * Тариф агентства по числу анкет (payments.md §3.3, D-13 — заменяет плоский
 * тариф D-07). Сетку правит админ: диапазон анкет + цена по сроку. Плюс
 * индивидуальный override у конкретной компании — сильнее сетки, если задан.
 */

/** Цена тарифа по сроку — все три срока обязательны, как и в PriceBookEntry:
 *  дырка в сетке — это тариф без цены. */
export const agencyTariffPricesSchema = z.record(planTermSchema, gcPriceSchema);
export type AgencyTariffPrices = z.infer<typeof agencyTariffPricesSchema>;

/** Индивидуальный override цены: `null` по сроку — «использовать цену тарифа». */
export const agencyTariffCustomPricesSchema = z.object({
  m1: gcPriceSchema.nullable(),
  m6: gcPriceSchema.nullable(),
  m12: gcPriceSchema.nullable(),
});
export type AgencyTariffCustomPrices = z.infer<typeof agencyTariffCustomPricesSchema>;

export const agencyTariffTierInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    minProfiles: z.number().int().min(1).max(10_000),
    maxProfiles: z.number().int().min(1).max(10_000),
    isDefault: z.boolean(),
    isActive: z.boolean(),
    prices: agencyTariffPricesSchema,
  })
  .refine((tier) => tier.maxProfiles >= tier.minProfiles, {
    message: 'Верхняя граница диапазона не может быть меньше нижней',
    path: ['maxProfiles'],
  });
export type AgencyTariffTierInput = z.infer<typeof agencyTariffTierInputSchema>;

export const agencyTariffTierSchema = agencyTariffTierInputSchema.extend({
  id: z.string(),
  position: z.number().int(),
});
export type AgencyTariffTier = z.infer<typeof agencyTariffTierSchema>;

/** Сетка тарифов, какой её видит и правит админка — по возрастанию `position`. */
export const agencyTariffGridSchema = z.array(agencyTariffTierSchema);
export type AgencyTariffGrid = z.infer<typeof agencyTariffGridSchema>;

/** Ручной override компании: тариф из сетки и/или индивидуальный лимит/цены. */
export const companyTariffOverrideInputSchema = z.object({
  tariffTierId: z.string().nullable(),
  customProfileLimit: z.number().int().min(1).max(10_000).nullable(),
  customPrices: agencyTariffCustomPricesSchema,
});
export type CompanyTariffOverrideInput = z.infer<typeof companyTariffOverrideInputSchema>;

/** Один тариф-кандидат в пейволе: сам тариф и доплата по каждому сроку. */
export const agencyTariffCandidateSchema = z.object({
  tier: agencyTariffTierSchema,
  upgradeCostGc: z.record(planTermSchema, z.number().int().nonnegative()),
});
export type AgencyTariffCandidate = z.infer<typeof agencyTariffCandidateSchema>;

export const companyTariffStateSchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  /** `false` сразу после регистрации агентства, пока карточка компании не
   *  заполнена (`PUT /me/company`) — тогда тарифа ещё нет, и действует
   *  аварийный fallback. Это нормальное состояние, а не ошибка: кабинет
   *  показывает по нему подсказку заполнить компанию, а не отказ. */
  hasCompany: z.boolean(),
  profileCount: z.number().int().nonnegative(),
  tariffTier: agencyTariffTierSchema.nullable(),
  customProfileLimit: z.number().int().nullable(),
  customPrices: agencyTariffCustomPricesSchema,
  effectiveLimit: z.number().int(),
  /** Тарифы, на которые можно перейти прямо сейчас, с доплатой за каждый —
   *  то же самое, что видно в пейволе, только доступно и до того, как лимит
   *  реально упёрся: кабинет может предложить апгрейд заранее. */
  candidateTiers: z.array(agencyTariffCandidateSchema),
  /** Ниже — только для объединённой карточки агентства в модерации
   *  (`/admin/companies/:id`): бан, ТОП, владелец под быстрые действия. */
  ownerId: z.string(),
  ownerEmail: z.string().nullable(),
  ownerEmailVerified: z.boolean(),
  /** Те же детали аккаунта, что видны на карточке пользователя
   *  (`ManagedUserDetail`) — чтобы объединённая карточка агентства не
   *  отправляла за ролью/балансом/датами на отдельную страницу. */
  ownerRole: userRoleSchema,
  ownerGlowcoinBalance: z.number().int().nonnegative(),
  ownerCreatedAt: z.string().datetime(),
  ownerLastLoginAt: z.string().datetime().nullable(),
  ownerLocale: z.string(),
  isBanned: z.boolean(),
  banReason: z.string().nullable(),
  bannedAt: z.string().datetime().nullable(),
  isFeatured: z.boolean(),
  topExpiresAt: z.string().datetime().nullable(),
  /** Анкеты компании — только в объединённой карточке в модерации
   *  (`GET /admin/companies/:id/tariff`). Владельцу тот же список уже виден
   *  в собственном кабинете, здесь его не считаем. */
  profiles: z.array(profileSummarySchema).optional(),
});
export type CompanyTariffState = z.infer<typeof companyTariffStateSchema>;

/**
 * Пейвол: сколько анкет уже есть, действующий лимит и тариф, и на что можно
 * перейти — с суммой доплаты, которую агентство увидит в модалке.
 */
export const agencyPaywallInfoSchema = z.object({
  currentProfileCount: z.number().int().nonnegative(),
  effectiveLimit: z.number().int(),
  currentTier: agencyTariffTierSchema.nullable(),
  candidateTiers: z.array(agencyTariffCandidateSchema),
});
export type AgencyPaywallInfo = z.infer<typeof agencyPaywallInfoSchema>;

export const agencyTariffUpgradeInputSchema = z.object({
  tierId: z.string().min(1),
  term: planTermSchema,
});
export type AgencyTariffUpgradeInput = z.infer<typeof agencyTariffUpgradeInputSchema>;

/**
 * Действующий предел анкет: индивидуальный override сильнее тарифа, тариф
 * сильнее аварийного fallback (последний не должен срабатывать в норме —
 * см. BillingSettings.agencyProfileLimit).
 */
export function effectiveProfileLimit(
  tier: { maxProfiles: number } | null,
  customProfileLimit: number | null,
  fallbackLimit: number,
): number {
  if (customProfileLimit !== null) return customProfileLimit;
  if (tier) return tier.maxProfiles;
  return fallbackLimit;
}

/** Действующая цена тарифа за срок: индивидуальная цена сильнее цены тарифа. */
export function effectiveTierPriceGc(
  term: PlanTerm,
  tier: { prices: AgencyTariffPrices } | null,
  customPrices: AgencyTariffCustomPrices,
  fallbackGc: number,
): number {
  const custom = customPrices[term];
  if (custom !== null) return custom;
  if (tier) return tier.prices[term];
  return fallbackGc;
}

/**
 * Доплата за переход на более высокий тариф в рамках уже оплаченного
 * периода размещения (payments.md §3.3, D-13): полная цена нового тарифа за
 * срок минус кредит за неиспользованный остаток текущего периода.
 *
 * Кредит считается от цены ТЕКУЩЕГО тарифа за срок оплаченного периода —
 * исторической цены на момент покупки система не хранит. Периода нет (только
 * зарегистрировались, оплаты не было) — кредита нет, доплата равна полной
 * цене нового тарифа.
 */
export function upgradeCostGc(params: {
  targetPriceGc: number;
  currentTermPriceGc: number;
  /** Длина оплаченного периода в днях. */
  periodDays: number;
  /** Сколько дней периода осталось на момент расчёта. */
  remainingDays: number;
}): number {
  const clampedRemaining = Math.max(0, Math.min(params.remainingDays, params.periodDays));
  const creditGc =
    params.periodDays > 0
      ? Math.round((params.currentTermPriceGc * clampedRemaining) / params.periodDays)
      : 0;
  return Math.max(0, params.targetPriceGc - creditGc);
}

/** Тарифы, которые расширяют предел выше текущего числа анкет — кандидаты
 *  на повышение в пейволе, по порядку сетки. Обобщённая по входному типу:
 *  вызывающему нужны либо только эти поля, либо весь `AgencyTariffTier`. */
export function candidateTiersFor<
  T extends { position: number; maxProfiles: number; isActive: boolean },
>(tiers: T[], currentProfileCount: number): T[] {
  return tiers
    .filter((tier) => tier.isActive && tier.maxProfiles > currentProfileCount)
    .sort((a, b) => a.position - b.position);
}
