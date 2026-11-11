import { describe, expect, it } from 'vitest';
import { countryFromHeaders } from './location-cookie';

const headers = (map: Record<string, string>) => (name: string) => map[name] ?? null;

describe('страна посетителя по заголовкам', () => {
  it('геозаголовок надёжнее языка браузера', () => {
    expect(countryFromHeaders(headers({ 'cf-ipcountry': 'pl', 'accept-language': 'de-DE' }))).toBe(
      'PL',
    );
  });

  it('служебные значения Cloudflare не считаются страной', () => {
    expect(countryFromHeaders(headers({ 'cf-ipcountry': 'XX' }))).toBeNull();
    expect(countryFromHeaders(headers({ 'cf-ipcountry': 'T1' }))).toBeNull();
  });

  it('без геозаголовка берётся регион языка браузера', () => {
    expect(countryFromHeaders(headers({ 'accept-language': 'de-AT,de;q=0.9,en;q=0.8' }))).toBe(
      'AT',
    );
  });

  it('язык без региона страны не даёт', () => {
    expect(countryFromHeaders(headers({ 'accept-language': 'ru,en;q=0.5' }))).toBeNull();
    expect(countryFromHeaders(headers({}))).toBeNull();
  });
});
