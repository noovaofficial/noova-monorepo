// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyStoredSessionHint,
  clearSessionHint,
  ROLE_COOKIE,
  SIGNED_IN_COOKIE,
  setSessionHint,
} from './session-hint';

function setCookie(name: string, value: string): void {
  // biome-ignore lint/suspicious/noDocumentCookie: тестовый хелпер, тот же приём, что и в проверяемом коде
  document.cookie = `${name}=${value}; path=/`;
}

function hasCookie(name: string): boolean {
  return document.cookie.split('; ').some((entry) => entry.startsWith(`${name}=`));
}

afterEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: тестовый хелпер, тот же приём, что и в проверяемом коде
  document.cookie = `${SIGNED_IN_COOKIE}=; path=/; max-age=0`;
  // biome-ignore lint/suspicious/noDocumentCookie: тестовый хелпер, тот же приём, что и в проверяемом коде
  document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0`;
  document.documentElement.removeAttribute('data-signed-in');
  document.documentElement.removeAttribute('data-role');
});

describe('clearSessionHint', () => {
  it('стирает и подсказку в разметке, и сами публичные куки', () => {
    setCookie(SIGNED_IN_COOKIE, '1');
    setCookie(ROLE_COOKIE, 'moderator');
    setSessionHint();
    applyStoredSessionHint();
    expect(document.documentElement.getAttribute('data-role')).toBe('moderator');

    clearSessionHint();

    // Без этого `proxy.ts` на следующей загрузке снова прочитал бы протухшую
    // роль из куки и увёл бы гостя с главной на закрытую для роли страницу.
    expect(hasCookie(SIGNED_IN_COOKIE)).toBe(false);
    expect(hasCookie(ROLE_COOKIE)).toBe(false);
    expect(document.documentElement.hasAttribute('data-signed-in')).toBe(false);
    expect(document.documentElement.hasAttribute('data-role')).toBe(false);
  });
});
