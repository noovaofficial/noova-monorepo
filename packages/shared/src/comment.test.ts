import { describe, expect, it } from 'vitest';
import { createCommentSchema, profileCommentSchema } from './comment';
import { queueItemSchema } from './moderation';

describe('контракт комментариев', () => {
  it('в публичном комментарии нет числовой оценки', () => {
    // Решение 4 в planning.md: агрегированный рейтинг живого человека —
    // инструмент травли. Текст модерируется и снимается, среднее — нет.
    const keys = Object.keys(profileCommentSchema.shape);
    expect(keys).not.toContain('rating');
    expect(keys).not.toContain('score');
    expect(keys).not.toContain('stars');
  });

  it('в публичном комментарии нет полей, зависящих от смотрящего', () => {
    // Этот список отдаётся страницей анкеты и кэшируется ISR. Попади сюда
    // «можно ли пожаловаться» — в кэш лёг бы ответ для случайного гостя.
    const keys = Object.keys(profileCommentSchema.shape);
    for (const viewerField of ['canReport', 'isMine', 'status', 'moderationNote']) {
      expect(keys).not.toContain(viewerField);
    }
  });

  it('не принимает пустой и слишком короткий текст', () => {
    expect(createCommentSchema.safeParse({ body: '' }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: 'коротко' }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: 'Достаточно длинный отзыв' }).success).toBe(true);
  });

  it('комментарий разбирается очередью модерации', () => {
    const parsed = queueItemSchema.safeParse({
      kind: 'comment',
      id: 'c1',
      body: 'текст',
      status: 'pending',
      authorNickname: 'tester',
      createdAt: '2026-08-21T00:00:00.000Z',
      profile: { id: 'p1', slug: 'a-b', displayName: 'A', cityName: 'Berlin' },
      reports: [],
    });
    expect(parsed.success).toBe(true);
  });
});
