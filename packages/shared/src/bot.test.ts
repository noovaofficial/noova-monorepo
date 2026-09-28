import { describe, expect, it } from 'vitest';
import { isBotUserAgent } from './bot';

describe('isBotUserAgent', () => {
  it('ловит поисковых роботов и краулеры', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
    ]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
  });

  it('ловит сборщики превью ссылок', () => {
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isBotUserAgent('WhatsApp/2.23.0')).toBe(true);
  });

  it('ловит headless-браузеры и автоматизацию', () => {
    expect(
      isBotUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0'),
    ).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (X11; Linux x86_64) Puppeteer/21.0')).toBe(true);
  });

  it('ловит типовые HTTP-библиотеки и пустой User-Agent', () => {
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent('python-requests/2.31.0')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
  });

  it('не трогает обычные браузеры', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false);
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
  });
});
