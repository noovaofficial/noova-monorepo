import { z } from 'zod';
import { citySchema, slugSchema } from './common';

/** Слот промо-слайдера. Всегда помечается как реклама — требование прозрачности. */
export const promoSlotSchema = z.object({
  id: z.string(),
  profileSlug: slugSchema.nullable(),
  href: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  imageUrl: z.string().nullable(),
  city: citySchema.nullable(),
});
export type PromoSlot = z.infer<typeof promoSlotSchema>;
