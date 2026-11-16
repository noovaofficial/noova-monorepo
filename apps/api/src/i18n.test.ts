import { describe, expect, it } from 'vitest';
import { currentLocale, placeName, requestLocale } from './i18n';

const warsaw = {
  name: 'Warschau',
  translations: [
    { locale: 'en', name: 'Warsaw' },
    { locale: 'ru', name: 'Варшава' },
  ],
};

describe('название места на языке запроса', () => {
  it('вне запроса — язык по умолчанию и базовое название', () => {
    expect(currentLocale()).toBe('de');
    expect(placeName(warsaw)).toBe('Warschau');
  });

  it('внутри запроса берёт его язык, в том числе после await', async () => {
    await requestLocale.run('ru', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentLocale()).toBe('ru');
      expect(placeName(warsaw)).toBe('Варшава');
    });
    expect(currentLocale()).toBe('de');
  });

  it('одновременные запросы не видят язык друг друга', async () => {
    const seen = await Promise.all(
      (['en', 'ru'] as const).map((locale) =>
        requestLocale.run(locale, async () => {
          await new Promise((resolve) => setTimeout(resolve, locale === 'en' ? 5 : 1));
          return placeName(warsaw);
        }),
      ),
    );
    expect(seen).toEqual(['Warsaw', 'Варшава']);
  });

  it('нет перевода на язык — базовое название, а не пусто', () => {
    expect(placeName(warsaw, 'pl')).toBe('Warschau');
    expect(placeName(warsaw, 'en')).toBe('Warsaw');
  });
});
