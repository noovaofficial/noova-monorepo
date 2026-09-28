// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CONSENT_COOKIE, setConsent } from '@/layout/cookie-consent';
import { buildSessionPayload } from './session';

afterEach(() => {
  document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
});

describe('buildSessionPayload', () => {
  it('берёт метки из строки запроса, а путь оставляет без неё', () => {
    const payload = buildSessionPayload(
      'abcdefghijklmnop1234',
      { pathname: '/de/berlin', search: '?utm_source=test&utm_campaign=c1&q=secret' },
      '',
    );
    expect(payload.landingPath).toBe('/de/berlin');
    expect(payload.utmSource).toBe('test');
    expect(payload.utmCampaign).toBe('c1');
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('отправляет только хост реферера', () => {
    const payload = buildSessionPayload(
      'abcdefghijklmnop1234',
      { pathname: '/', search: '' },
      'https://www.google.com/search?q=private',
    );
    expect(payload.referrerHost).toBe('google.com');
    expect(JSON.stringify(payload)).not.toContain('private');
  });

  it('без решения баннера — согласия нет', () => {
    expect(
      buildSessionPayload('abcdefghijklmnop1234', { pathname: '/', search: '?click_id=x' }, '')
        .consent,
    ).toBe(false);
  });

  it('после «да» в баннере — согласие есть', () => {
    setConsent('yes');
    expect(
      buildSessionPayload('abcdefghijklmnop1234', { pathname: '/', search: '?click_id=x' }, '')
        .consent,
    ).toBe(true);
  });

  it('явное «нет» в баннере — согласия всё ещё нет', () => {
    setConsent('no');
    expect(
      buildSessionPayload('abcdefghijklmnop1234', { pathname: '/', search: '?click_id=x' }, '')
        .consent,
    ).toBe(false);
  });
});
