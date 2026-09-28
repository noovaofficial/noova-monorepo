// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyStoredConsent,
  CONSENT_COOKIE,
  hasAnalyticsConsent,
  resetConsent,
  setConsent,
} from './cookie-consent';

function clearCookies() {
  document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
  document.documentElement.removeAttribute('data-consent');
}

afterEach(clearCookies);

describe('setConsent', () => {
  it('пишет куку и атрибут документа', () => {
    setConsent('yes');
    expect(document.cookie).toContain(`${CONSENT_COOKIE}=yes`);
    expect(document.documentElement.getAttribute('data-consent')).toBe('yes');
  });

  it('явное «нет» тоже сохраняется — баннер не должен спрашивать снова', () => {
    setConsent('no');
    expect(document.cookie).toContain(`${CONSENT_COOKIE}=no`);
    expect(document.documentElement.getAttribute('data-consent')).toBe('no');
  });
});

describe('hasAnalyticsConsent', () => {
  it('true только при явном «да»', () => {
    expect(hasAnalyticsConsent()).toBe(false);
    setConsent('no');
    expect(hasAnalyticsConsent()).toBe(false);
    setConsent('yes');
    expect(hasAnalyticsConsent()).toBe(true);
  });
});

describe('applyStoredConsent', () => {
  it('восстанавливает атрибут из куки', () => {
    document.cookie = `${CONSENT_COOKIE}=yes; path=/`;
    document.documentElement.removeAttribute('data-consent');
    applyStoredConsent();
    expect(document.documentElement.getAttribute('data-consent')).toBe('yes');
  });

  it('ничего не делает без куки', () => {
    applyStoredConsent();
    expect(document.documentElement.hasAttribute('data-consent')).toBe(false);
  });
});

describe('resetConsent', () => {
  it('стирает куку и атрибут', () => {
    setConsent('yes');
    resetConsent();
    expect(document.cookie).not.toContain(`${CONSENT_COOKIE}=yes`);
    expect(document.documentElement.hasAttribute('data-consent')).toBe(false);
    expect(hasAnalyticsConsent()).toBe(false);
  });
});
