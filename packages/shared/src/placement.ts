import { z } from 'zod';

/**
 * Правила размещения по месту (страна или город) × тип рекламодателя.
 * Пустое поле — «не переопределено»: город сильнее страны, страна сильнее
 * умолчания (платно, разрешено).
 */
export const PLACEMENT_KINDS = ['individual', 'salon', 'agency'] as const;
export const placementKindSchema = z.enum(PLACEMENT_KINDS);

export const placementRuleSchema = z.object({
  countryId: z.string().nullable(),
  cityId: z.string().nullable(),
  kind: placementKindSchema,
  /** false — размещение бесплатное. */
  paid: z.boolean().nullable(),
  /** false — публиковать новые анкеты этого типа здесь нельзя. */
  allowed: z.boolean().nullable(),
});
export type PlacementRule = z.infer<typeof placementRuleSchema>;

export const placementRuleInputSchema = z
  .object({
    countryId: z.string().min(1).optional(),
    cityId: z.string().min(1).optional(),
    kind: placementKindSchema,
    paid: z.boolean().nullable(),
    allowed: z.boolean().nullable(),
  })
  .refine((value) => (value.countryId === undefined) !== (value.cityId === undefined), {
    message: 'Нужно указать ровно одно: страну или город',
  });
export type PlacementRuleInput = z.infer<typeof placementRuleInputSchema>;
