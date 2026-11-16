import { describe, expect, it } from 'vitest';
import { buildCsp, cspMode } from './csp';

const base = {
  nonce: 'abc123',
  mode: 'report' as const,
  isDev: false,
  apiUrl: 'https://noova.example',
  mediaUrl: 'https://noova.example/media',
};

const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.split(' ')
    .slice(1);

describe('Content-Security-Policy сайта', () => {
  it('скрипты — только с меткой, без послаблений в проде', () => {
    const scripts = directive(buildCsp(base), 'script-src');
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it('unsafe-eval и websocket — только в разработке', () => {
    const csp = buildCsp({ ...base, isDev: true });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('ws:');
  });

  it('API и медиа на том же домене не дублируются', () => {
    expect(directive(buildCsp(base), 'connect-src')).toEqual(["'self'", 'https://noova.example']);
  });

  it('отдельный домен медиа попадает в картинки и видео', () => {
    const csp = buildCsp({ ...base, mediaUrl: 'https://cdn.example.net' });
    expect(directive(csp, 'img-src')).toContain('https://cdn.example.net');
    expect(directive(csp, 'media-src')).toContain('https://cdn.example.net');
  });

  it('запрещает встраивание во фреймы и чужие объекты', () => {
    const csp = buildCsp(base);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
  });

  it('upgrade-insecure-requests — только при блокировке', () => {
    expect(buildCsp(base)).not.toContain('upgrade-insecure-requests');
    expect(buildCsp({ ...base, mode: 'enforce' })).toContain('upgrade-insecure-requests');
  });

  it('отчёты уходят в API; без адреса API директивы нет', () => {
    expect(directive(buildCsp(base), 'report-uri')).toEqual([
      'https://noova.example/api/v1/csp-report',
    ]);
    expect(buildCsp({ ...base, apiUrl: 'мусор' })).not.toContain('report-uri');
  });

  it('неизвестное значение режима — отчёт, а не блокировка и не отключение', () => {
    expect(cspMode(undefined)).toBe('report');
    expect(cspMode('что-то')).toBe('report');
    expect(cspMode('enforce')).toBe('enforce');
    expect(cspMode('off')).toBe('off');
  });
});
