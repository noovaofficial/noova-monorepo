import { describe, expect, it } from 'vitest';
import {
  classifySource,
  deviceTypeFromUserAgent,
  hostFromUrl,
  normalizeHost,
  trackSessionSchema,
} from './attribution';

describe('classifySource', () => {
  it('без реферера и меток — прямой заход', () => {
    expect(classifySource({})).toEqual({ source: 'direct', network: null });
  });

  it('распознаёт платную сеть по utm_source', () => {
    expect(classifySource({ utmSource: 'ExoClick', utmMedium: 'cpc' })).toEqual({
      source: 'network',
      network: 'exoclick',
    });
  });

  it('сеть важнее реферера и остальных меток', () => {
    expect(classifySource({ utmSource: 'eroadvertising', referrerHost: 'google.com' }).source).toBe(
      'network',
    );
  });

  it('любая другая метка — utm', () => {
    expect(classifySource({ utmSource: 'test' })).toEqual({ source: 'utm', network: null });
    expect(classifySource({ utmCampaign: 'spring' }).source).toBe('utm');
  });

  it('метка важнее реферера', () => {
    expect(classifySource({ utmSource: 'newsletter', referrerHost: 'google.com' }).source).toBe(
      'utm',
    );
  });

  it('поисковик — органика, в том числе региональные домены и поддомены', () => {
    for (const host of ['www.google.com', 'google.de', 'search.yahoo.com', 'duckduckgo.com']) {
      expect(classifySource({ referrerHost: host }).source).toBe('organic');
    }
  });

  it('прочий реферер — referral', () => {
    expect(classifySource({ referrerHost: 'forum.example.org' }).source).toBe('referral');
  });

  it('собственный хост — не реферал', () => {
    expect(classifySource({ referrerHost: 'berlin.noova.de', ownHosts: ['noova.de'] }).source).toBe(
      'direct',
    );
  });

  it('пустые и пробельные метки игнорируются', () => {
    expect(classifySource({ utmSource: '  ', referrerHost: '' }).source).toBe('direct');
  });
});

describe('хосты', () => {
  it('срезает www и приводит к нижнему регистру', () => {
    expect(normalizeHost('WWW.Google.COM')).toBe('google.com');
  });

  it('берёт хост из URL и не падает на мусоре', () => {
    expect(hostFromUrl('https://www.google.com/search?q=x')).toBe('google.com');
    expect(hostFromUrl('not a url')).toBeNull();
    expect(hostFromUrl('')).toBeNull();
  });
});

describe('deviceTypeFromUserAgent', () => {
  it('различает мобильные, планшеты и десктоп', () => {
    expect(
      deviceTypeFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Mobile/15E148'),
    ).toBe('mobile');
    expect(deviceTypeFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet');
    expect(deviceTypeFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile')).toBe('mobile');
    expect(deviceTypeFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-T870)')).toBe('tablet');
    expect(deviceTypeFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('desktop');
    expect(deviceTypeFromUserAgent(undefined)).toBe('desktop');
  });
});

describe('trackSessionSchema', () => {
  const base = { sessionId: 'abcdefghijklmnop1234', landingPath: '/berlin' };

  it('принимает минимальное тело', () => {
    expect(trackSessionSchema.parse(base).consent).toBe(false);
  });

  it('отклоняет путь со строкой запроса и короткий идентификатор', () => {
    expect(trackSessionSchema.safeParse({ ...base, landingPath: '/berlin?q=1' }).success).toBe(
      false,
    );
    expect(trackSessionSchema.safeParse({ ...base, sessionId: 'short' }).success).toBe(false);
  });
});
