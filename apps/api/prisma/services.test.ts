import { MAX_SERVICES_PER_PROFILE, updateProfileSchema } from '@noova/shared';
import { describe, expect, it } from 'vitest';
import { loadReferenceData } from '../src/reference-data';

const { services: SERVICES, serviceGroups: SERVICE_GROUPS } = loadReferenceData();

/** В справочнике лежат и отключённые услуги прежних версий — их не выбрать. */
const SERVICE_CATALOG = SERVICES.filter((service) => service.isActive);

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
    const groups = new Set(SERVICE_GROUPS.map((group) => group.key));
    for (const service of SERVICE_CATALOG) {
      expect(groups.has(service.group), `${service.key} → ${service.group}`).toBe(true);
    }
  });

  it('в каждой группе есть хотя бы одна услуга', () => {
    for (const group of SERVICE_GROUPS) {
      const count = SERVICE_CATALOG.filter((service) => service.group === group.key).length;
      expect(count, group.key).toBeGreaterThan(0);
    }
  });
});
