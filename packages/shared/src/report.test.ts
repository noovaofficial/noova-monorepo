import { describe, expect, it } from 'vitest';
import { queueItemSchema } from './moderation';
import { createProfileReportSchema, isUrgentReason, PROFILE_REPORT_REASONS } from './report';

describe('жалобы на анкету', () => {
  it('несовершеннолетняя и принуждение срочные, остальное нет', () => {
    // Это не «важнее» в смысле удобства: речь о возможном преступлении,
    // и такая жалоба не должна лежать за десятком сообщений о спаме.
    expect(isUrgentReason('underage')).toBe(true);
    expect(isUrgentReason('coercion')).toBe(true);
    expect(isUrgentReason('spam')).toBe(false);
    expect(isUrgentReason('other')).toBe(false);
  });

  it('срочные причины стоят первыми в форме', () => {
    expect(PROFILE_REPORT_REASONS.slice(0, 2)).toEqual(['underage', 'coercion']);
  });

  it('пояснение обязательно и содержательно', () => {
    // Одна категория ничего не даёт: «краденые фото» без указания,
    // чьи и где, проверить нельзя.
    expect(createProfileReportSchema.safeParse({ reason: 'spam', details: '' }).success).toBe(
      false,
    );
    expect(
      createProfileReportSchema.safeParse({ reason: 'spam', details: 'коротко' }).success,
    ).toBe(false);
    expect(
      createProfileReportSchema.safeParse({ reason: 'spam', details: 'Навязчивая реклама сайта' })
        .success,
    ).toBe(true);
  });

  it('причина только из перечисления', () => {
    const parsed = createProfileReportSchema.safeParse({
      reason: 'мне не нравится',
      details: 'достаточно длинное пояснение',
    });
    expect(parsed.success).toBe(false);
  });

  it('жалоба разбирается очередью модерации', () => {
    const parsed = queueItemSchema.safeParse({
      kind: 'report',
      id: 'r1',
      reason: 'underage',
      details: 'пояснение',
      isUrgent: true,
      reporterEmail: null,
      createdAt: '2026-08-21T00:00:00.000Z',
      profile: { id: 'p1', slug: 'a-b', displayName: 'A', cityName: 'Berlin' },
      otherOpenReports: 0,
    });
    expect(parsed.success).toBe(true);
  });
});
