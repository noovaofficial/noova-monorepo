import type { ProfileQuery } from '@noova/shared';
import { describe, expect, it } from 'vitest';
import { buildProfileWhere, decodeCursor, encodeCursor, orderByFor } from './query';

const query = (extra: Partial<ProfileQuery> = {}): ProfileQuery =>
  ({ kind: 'escort', limit: 20, sort: 'relevance', ...extra }) as ProfileQuery;

describe('построитель фильтров каталога', () => {
  /**
   * Самое дорогое из того, что здесь может сломаться: неопубликованная анкета
   * в публичной выдаче. Черновик или заблокированная утекли бы вместе с
   * контактами, и заметить это по интерфейсу почти невозможно.
   */
  it('всегда ограничивает выдачу опубликованными', () => {
    expect(buildProfileWhere(query())).toMatchObject({ status: 'published' });
    expect(buildProfileWhere(query({ city: 'berlin', onlineOnly: true }))).toMatchObject({
      status: 'published',
    });
  });

  it('пустой запрос не добавляет лишних условий', () => {
    expect(Object.keys(buildProfileWhere(query())).sort()).toEqual(['kind', 'status']);
  });

  /**
   * Услуги складываются через И, а не ИЛИ: выбрав «ужин» и «выезд», человек
   * ищет ту, кто делает и то и другое. При ИЛИ выдача была бы шире запроса,
   * и ошибка выглядела бы как «фильтр не работает».
   */
  it('несколько услуг требует одновременно', () => {
    const where = buildProfileWhere(query({ services: ['dinner_date', 'outcall'] }));
    expect(where.AND).toEqual([
      { services: { some: { service: { key: 'dinner_date' } } } },
      { services: { some: { service: { key: 'outcall' } } } },
    ]);
  });

  /** Значения одного параметра — наоборот, через ИЛИ: это выбор из списка. */
  it('значения одного параметра складывает через ИЛИ', () => {
    expect(buildProfileWhere(query({ eyeColor: ['blue', 'green'] }))).toMatchObject({
      eyeColor: { in: ['blue', 'green'] },
    });
  });

  it('языки ищет по пересечению', () => {
    expect(buildProfileWhere(query({ languages: ['de', 'ru'] }))).toMatchObject({
      languages: { hasSome: ['de', 'ru'] },
    });
  });

  it('диапазоны собирает с обеих границ и по отдельности', () => {
    expect(buildProfileWhere(query({ ageMin: 20, ageMax: 30 }))).toMatchObject({
      age: { gte: 20, lte: 30 },
    });
    expect(buildProfileWhere(query({ heightMin: 165 }))).toMatchObject({
      heightCm: { gte: 165 },
    });
    expect(buildProfileWhere(query({ maxPriceCents: 20000 }))).toMatchObject({
      fromPriceCents: { lte: 20000 },
    });
  });

  it('различает отсутствие признака и значение false', () => {
    expect(buildProfileWhere(query())).not.toHaveProperty('hasPiercing');
    expect(buildProfileWhere(query({ hasPiercing: false }))).toMatchObject({
      hasPiercing: false,
    });
  });

  it('«с отзывами» считает только опубликованные', () => {
    expect(buildProfileWhere(query({ withCommentsOnly: true }))).toMatchObject({
      comments: { some: { status: 'published' } },
    });
  });

  it('онлайн отсчитывает окно от текущего момента', () => {
    const where = buildProfileWhere(query({ onlineOnly: true })) as {
      lastSeenAt: { gte: Date };
    };
    const ago = Date.now() - where.lastSeenAt.gte.getTime();
    expect(ago).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000);
    expect(ago).toBeLessThan(11 * 60 * 1000);
  });
});

describe('курсор', () => {
  it('переживает кодирование и обратно', () => {
    expect(decodeCursor(encodeCursor('cmt19tfre0001z7b0jevq7fcj'))).toBe(
      'cmt19tfre0001z7b0jevq7fcj',
    );
  });

  /** Курсор приходит из адреса и может быть каким угодно: падать нельзя. */
  it('на мусоре возвращает undefined, а не бросает', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
    expect(decodeCursor('!!!не-base64!!!')).toBeUndefined();
  });
});

describe('сортировка', () => {
  /**
   * Без `id` последним курсорная пагинация разъезжается на записях с
   * одинаковым ключом: часть анкет пропадает со второй страницы, часть
   * повторяется. Проявляется только на данных с дублями — тестом дешевле.
   */
  it('во всех вариантах заканчивается id', () => {
    for (const sort of ['relevance', 'newest', 'price_asc', 'price_desc'] as const) {
      const order = orderByFor(sort);
      expect(Object.keys(order[order.length - 1] ?? {}), sort).toEqual(['id']);
    }
  });

  it('релевантность поднимает промо наверх', () => {
    expect(orderByFor('relevance')[0]).toEqual({ isFeatured: 'desc' });
  });
});
