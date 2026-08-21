import { MAX_SERVICES_PER_PROFILE, updateProfileSchema } from '@noova/shared';
import { describe, expect, it } from 'vitest';
import { SERVICE_CATALOG, SERVICE_GROUPS } from './services';

describe('справочник услуг', () => {
  /**
   * Регрессия: лимит на массив услуг стоял 60, а каталог вырос до 61.
   * Владелец, отметивший все услуги, получал 400 — и по сообщению
   * «Некорректные параметры запроса» причина была неочевидна.
   */
  it('целиком помещается в лимит запроса', () => {
    expect(SERVICE_CATALOG.length).toBeLessThan(MAX_SERVICES_PER_PROFILE);

    const all = SERVICE_CATALOG.map((service) => ({ key: service.key, isExtra: false }));
    expect(updateProfileSchema.safeParse({ services: all }).success).toBe(true);
  });

  it('не содержит повторяющихся ключей', () => {
    const keys = SERVICE_CATALOG.map((service) => service.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ссылается только на объявленные группы', () => {
    const groups = new Set<string>(SERVICE_GROUPS);
    for (const service of SERVICE_CATALOG) {
      expect(groups.has(service.group), `${service.key} → ${service.group}`).toBe(true);
    }
  });

  it('в каждой группе есть хотя бы одна услуга', () => {
    for (const group of SERVICE_GROUPS) {
      const count = SERVICE_CATALOG.filter((service) => service.group === group).length;
      expect(count, group).toBeGreaterThan(0);
    }
  });
});
