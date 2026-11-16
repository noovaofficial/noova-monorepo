import { describe, expect, it } from 'vitest';
import { isExtensionNoise, parseCspReport } from './report';

describe('отчёт о нарушении CSP', () => {
  it('разбирает старый формат (report-uri)', () => {
    const [violation] = parseCspReport(
      JSON.stringify({
        'csp-report': {
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js',
          'document-uri': 'https://noova.example/ru/reset?token=secret',
          'source-file': 'https://noova.example/_next/static/a.js',
          'line-number': 12,
          disposition: 'report',
        },
      }),
    );
    expect(violation).toMatchObject({
      directive: 'script-src-elem',
      blocked: 'https://evil.example/x.js',
      line: 12,
      disposition: 'report',
    });
    // Токен из адреса страницы в лог попасть не должен.
    expect(violation?.page).toBe('https://noova.example/ru/reset');
  });

  it('разбирает новый формат (Reporting API)', () => {
    const violations = parseCspReport(
      JSON.stringify([
        {
          type: 'csp-violation',
          body: { effectiveDirective: 'img-src', blockedURL: 'https://x.example/a.png' },
        },
      ]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      directive: 'img-src',
      blocked: 'https://x.example/a.png',
    });
  });

  it('мусор не роняет разбор', () => {
    expect(parseCspReport('не json')).toEqual([]);
    expect(parseCspReport('{"csp-report":"строка"}')).toEqual([]);
    expect(parseCspReport('[1,2,null]')).toEqual([]);
    expect(parseCspReport('{"csp-report":{}}')).toEqual([]);
  });

  it('обрезает длинные значения', () => {
    const [violation] = parseCspReport(
      JSON.stringify({
        'csp-report': { 'effective-directive': 'script-src', 'script-sample': 'x'.repeat(5000) },
      }),
    );
    expect(violation?.sample).toHaveLength(120);
  });

  it('отличает расширения браузера от нарушений сайта', () => {
    const base = { directive: 'script-src', page: '', line: null, sample: '', disposition: '' };
    expect(
      isExtensionNoise({ ...base, blocked: 'inline', source: 'chrome-extension://abc/x.js' }),
    ).toBe(true);
    expect(isExtensionNoise({ ...base, blocked: 'moz-extension://abc', source: '' })).toBe(true);
    expect(isExtensionNoise({ ...base, blocked: 'https://evil.example', source: '' })).toBe(false);
  });
});
