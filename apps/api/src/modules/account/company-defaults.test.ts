import { describe, expect, it } from 'vitest';
import { inheritContacts } from './company-defaults';

describe('inheritContacts', () => {
  it('приводит значения к каноническому виду и нумерует позиции подряд', () => {
    const result = inheritContacts([
      { type: 'phone', value: '+49 170 1234567' },
      { type: 'telegram', value: 'agency_name' },
    ]);
    expect(result).toEqual([
      { type: 'phone', value: '+491701234567', position: 0 },
      { type: 'telegram', value: '@agency_name', position: 1 },
    ]);
  });

  it('схлопывает дубли после нормализации', () => {
    const result = inheritContacts([
      { type: 'phone', value: '+49 170 1234567' },
      { type: 'phone', value: '+49(170)1234567' },
    ]);
    expect(result).toHaveLength(1);
  });

  it('пропускает некорректные строки, не роняя остальные', () => {
    const result = inheritContacts([
      { type: 'phone', value: 'abc' },
      { type: 'telegram', value: '@ok_name' },
    ]);
    expect(result).toEqual([{ type: 'telegram', value: '@ok_name', position: 0 }]);
  });
});
