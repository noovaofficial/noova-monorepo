export type Theme = 'light' | 'dark';

export const THEME_COOKIE = 'noova_theme';
export const DEFAULT_THEME: Theme = 'dark';

export function isTheme(value: string | undefined): value is Theme {
  return value === 'light' || value === 'dark';
}

function cookieValue(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Возвращает атрибут темы из куки. Нужна после перемонтирования layout
 * (например, при смене языка): инлайн-скрипт к этому моменту уже отработал,
 * и восстановить выбор больше некому.
 */
export function applyStoredTheme(): Theme {
  const stored = cookieValue(THEME_COOKIE);
  const theme = isTheme(stored ?? undefined) ? (stored as Theme) : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

/**
 * Инлайн-скрипт в <head>: ставит тему до первой отрисовки.
 * Без него страница успевает мигнуть дефолтной темой, если в куке другая.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
  var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);
  var t=m?decodeURIComponent(m[1]):null;
  if(t!=='light'&&t!=='dark'){t='${DEFAULT_THEME}';}
  document.documentElement.setAttribute('data-theme',t);
}catch(e){}})();
`.trim();
