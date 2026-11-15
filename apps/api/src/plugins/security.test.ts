import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './security.js';

describe('ключ лимита запросов', () => {
  it('IPv4 считает по адресу', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('IPv4 в обёртке IPv6 — тот же IPv4', () => {
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('адреса одной подсети /64 дают один ключ', () => {
    const a = rateLimitKey('2001:db8:abcd:12:1111:2222:3333:4444');
    const b = rateLimitKey('2001:0db8:abcd:0012::1');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(b).toBe(a);
  });

  it('разные подсети — разные ключи', () => {
    expect(rateLimitKey('2001:db8:abcd:12::1')).not.toBe(rateLimitKey('2001:db8:abcd:13::1'));
  });

  it('разворачивает сокращённую запись', () => {
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });
});
