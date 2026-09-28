import { describe, expect, it } from 'vitest';
import { batchEventSchema, eventBatchSchema } from './event-batch';

const base = { name: 'page_view' as const, path: '/de/berlin', clientTs: Date.now() };

describe('batchEventSchema', () => {
  it('принимает минимальный page_view', () => {
    expect(batchEventSchema.safeParse(base).success).toBe(true);
  });

  it('отклоняет путь со строкой запроса', () => {
    expect(batchEventSchema.safeParse({ ...base, path: '/de/berlin?utm_source=x' }).success).toBe(
      false,
    );
  });

  it('отклоняет неизвестное имя события', () => {
    expect(batchEventSchema.safeParse({ ...base, name: 'click_everything' }).success).toBe(false);
  });

  it('принимает category только из перечня видов анкет', () => {
    expect(
      batchEventSchema.safeParse({ ...base, name: 'search_filter', category: 'escort' }).success,
    ).toBe(true);
    expect(
      batchEventSchema.safeParse({ ...base, name: 'search_filter', category: 'nightclub' }).success,
    ).toBe(false);
  });

  it('gallery_open несёт слаг анкеты', () => {
    expect(
      batchEventSchema.safeParse({ ...base, name: 'gallery_open', profileSlug: 'gloria-berlin' })
        .success,
    ).toBe(true);
  });
});

describe('eventBatchSchema', () => {
  it('требует хотя бы одно событие', () => {
    expect(eventBatchSchema.safeParse([]).success).toBe(false);
  });

  it('отклоняет батч больше 50 событий', () => {
    const events = Array.from({ length: 51 }, () => base);
    expect(eventBatchSchema.safeParse(events).success).toBe(false);
  });

  it('принимает батч из нескольких видов', () => {
    const events = [base, { ...base, name: 'gallery_open' as const, profileSlug: 'x' }];
    expect(eventBatchSchema.safeParse(events).success).toBe(true);
  });
});
