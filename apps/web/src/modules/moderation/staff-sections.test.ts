import type { UserRole } from '@noova/shared';
import { describe, expect, it } from 'vitest';
import { sectionsFor } from './staff-sections';

const keys = (role?: UserRole) => sectionsFor(role).map((section) => section.key);

describe('почта в меню персонала', () => {
  it('админ видит управление почтами и почтовый клиент', () => {
    expect(keys('admin')).toEqual(expect.arrayContaining(['mailAdmin', 'webmail']));
  });

  it('модератор видит только почтовый клиент', () => {
    expect(keys('moderator')).toContain('webmail');
    expect(keys('moderator')).not.toContain('mailAdmin');
  });

  it('клиенту, рекламодателю и гостю почта не видна', () => {
    for (const role of ['client', 'advertiser', undefined] as const) {
      expect(keys(role)).not.toContain('webmail');
      expect(keys(role)).not.toContain('mailAdmin');
    }
  });

  it('разделы почты — внешние адреса по https', () => {
    const mail = sectionsFor('admin').filter((section) => section.group === 'mail');
    expect(mail).toHaveLength(2);
    for (const section of mail) {
      expect(section.external).toBe(true);
      expect(section.href).toMatch(/^https:\/\//);
    }
  });
});
