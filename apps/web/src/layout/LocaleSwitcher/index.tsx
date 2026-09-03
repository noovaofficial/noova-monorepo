'use client';

import { LOCALES, type Locale } from '@noova/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import styles from './LocaleSwitcher.module.css';

/** Название языка на нём самом: так его узнают, не зная текущего языка сайта. */
const LABELS: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  ru: 'Русский',
};

export function LocaleSwitcher() {
  const t = useTranslations('nav');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Клик мимо меню закрывает его — иначе оно висит поверх карточек.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (next: Locale) => {
    setOpen(false);
    // Меняем только языковой префикс, оставаясь на том же маршруте.
    router.replace(pathname, { locale: next });
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <Button
        variant="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('language')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {locale.toUpperCase()}
      </Button>

      {open ? (
        <div className={styles.menu} role="menu">
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitem"
              className={`${styles.item} ${code === locale ? styles.active : ''}`}
              onClick={() => select(code)}
            >
              {LABELS[code]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
