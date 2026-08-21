import { favoriteItemSchema } from '@noova/shared';
import { describe, expect, it } from 'vitest';

describe('контракт избранного', () => {
  it('несёт признак доступности, а не выбрасывает снятую анкету', () => {
    // Смысл поля: снятая с публикации анкета остаётся в списке с пометкой.
    // Убери его — и карточка начнёт молча исчезать, что выглядит как баг.
    expect(favoriteItemSchema.shape.isAvailable).toBeDefined();

    const parsed = favoriteItemSchema.safeParse({
      profile: null,
      addedAt: '2026-08-20T00:00:00.000Z',
      isAvailable: false,
    });
    // Карточка обязательна: список без неё нечего показывать.
    expect(parsed.success).toBe(false);
  });
});
