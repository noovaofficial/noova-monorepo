import { z } from 'zod';
import { advertiserKindSchema } from './account';

/**
 * Акции (промо-предложения).
 *
 * Одна запись — одно предложение: «первые 50 рекламодателей в Берлине
 * получают 90 дней размещения». Условия пустые означают «любой»: акция без
 * города действует везде, без типа — на всех.
 */

export const campaignTriggerSchema = z.enum(['first_profile', 'promo_code']);
export type CampaignTrigger = z.infer<typeof campaignTriggerSchema>;
export const CAMPAIGN_TRIGGERS: readonly CampaignTrigger[] = ['first_profile', 'promo_code'];

/**
 * Промокод. Верхний регистр и узкий алфавит — потому что его диктуют вслух и
 * набирают руками: «berlin50» и «BERLIN50» обязаны быть одним кодом, а «O»
 * и «0» в одном коде спутает кто угодно.
 */
export const promoCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(4)
  .max(32)
  .regex(/^[A-Z0-9-]+$/, { message: 'Только латиница, цифры и дефис' });

/** Потолки наград — защита от лишнего нуля в поле, а не экономическое правило. */
export const CAMPAIGN_MAX_REWARD_GC = 100_000;
export const CAMPAIGN_MAX_REWARD_DAYS = 730;

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    trigger: campaignTriggerSchema,
    /** Обязателен и допустим только у `promo_code`. */
    code: promoCodeSchema.nullable().default(null),
    isActive: z.boolean().default(true),
    startsAt: z.string().datetime().nullable().default(null),
    endsAt: z.string().datetime().nullable().default(null),
    /** Пусто — любой город. */
    cityId: z.string().min(1).nullable().default(null),
    /** Пусто — любой тип рекламодателя. */
    advertiserKind: advertiserKindSchema.nullable().default(null),
    /** Пусто — без ограничения по числу выдач. */
    quota: z.number().int().min(1).max(1_000_000).nullable().default(null),
    rewardGc: z.number().int().min(0).max(CAMPAIGN_MAX_REWARD_GC).default(0),
    rewardListingDays: z.number().int().min(0).max(CAMPAIGN_MAX_REWARD_DAYS).default(0),
  })
  .refine((input) => input.rewardGc > 0 || input.rewardListingDays > 0, {
    message: 'Акция без награды ничего не даёт',
    path: ['rewardGc'],
  })
  .refine((input) => input.trigger !== 'promo_code' || input.code !== null, {
    // Акция по коду без кода не сработает никогда: вводить нечего.
    message: 'Промокод обязателен',
    path: ['code'],
  })
  .refine((input) => input.trigger === 'promo_code' || input.code === null, {
    // И наоборот: код у автоматической акции вводить некуда, он бы только
    // обещал способ её получить.
    message: 'Код бывает только у акции по промокоду',
    path: ['code'],
  })
  .refine(
    (input) =>
      !input.startsAt || !input.endsAt || new Date(input.startsAt) < new Date(input.endsAt),
    { message: 'Начало должно быть раньше конца', path: ['endsAt'] },
  );
export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: campaignTriggerSchema,
  code: z.string().nullable(),
  isActive: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  cityId: z.string().nullable(),
  /** Название города на языке запроса — админке нужно показать, а не искать. */
  cityName: z.string().nullable(),
  advertiserKind: advertiserKindSchema.nullable(),
  quota: z.number().int().nullable(),
  rewardGc: z.number().int(),
  rewardListingDays: z.number().int(),
  /** Сколько уже выдано. Считается по журналу выдач, а не хранится полем:
   *  счётчик рядом с журналом рано или поздно разошёлся бы с ним. */
  grantedCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
});
export type Campaign = z.infer<typeof campaignSchema>;

/** Что человек ввёл в кабинете. */
export const redeemPromoInputSchema = z.object({ code: promoCodeSchema });
export type RedeemPromoInput = z.infer<typeof redeemPromoInputSchema>;

/**
 * Итог применения акции. Возвращается и при вводе кода, и внутри — чтобы
 * показать человеку, что именно он получил, а не просто «успех».
 */
export const campaignRewardSchema = z.object({
  campaignName: z.string(),
  grantedGc: z.number().int().min(0),
  grantedDays: z.number().int().min(0),
  /** До какого числа теперь оплачено размещение. Пусто — акция дала только монеты. */
  listingExpiresAt: z.string().datetime().nullable(),
  balanceGc: z.number().int().min(0),
});
export type CampaignReward = z.infer<typeof campaignRewardSchema>;

/**
 * Почему код не сработал. Отдельные коды, а не текст: сообщение переводится
 * на все языки интерфейса, и собирать его на сервере значит держать там словари.
 */
export const redeemErrorSchema = z.enum([
  /** Кода нет вовсе, он выключен или срок вышел. Один ответ на все три
   *  случая намеренно: перебором кодов не должно быть видно, какие из них
   *  существуют. */
  'unknown',
  /** Условия акции не подходят этому человеку: другой город или тип. */
  'notEligible',
  /** Квота исчерпана. */
  'exhausted',
  /** Этот человек уже получал по этой акции. */
  'alreadyGranted',
]);
export type RedeemError = z.infer<typeof redeemErrorSchema>;
