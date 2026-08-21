'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { applyStoredTheme, DEFAULT_THEME, THEME_COOKIE, type Theme } from '@/design-system/theme';

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />
  </svg>
);

export function ThemeToggle() {
  const t = useTranslations('nav');
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  // Тема живёт в куке, а не в разметке. Читаем её после монтирования и заодно
  // возвращаем атрибут на место: при смене языка layout перемонтируется,
  // и выбор пользователя иначе теряется.
  useEffect(() => setTheme(applyStoredTheme()), []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    // Кука, а не localStorage: тема должна быть видна серверу и инлайн-скрипту
    // в <head> до первой отрисовки.
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API асинхронный и поддержан не везде
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    setTheme(next);
  };

  return (
    <Button variant="icon" onClick={toggle} aria-label={t('theme')} title={t('theme')}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
