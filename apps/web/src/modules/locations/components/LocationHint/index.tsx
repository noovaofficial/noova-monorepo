'use client';

import type { CityOption, CountryOption } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { currentLocation } from '@/modules/locations/current-location';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import { GEO_COOKIE, LOCATION_ACK_COOKIE, OPEN_LOCATION_EVENT } from '@/shared/location-cookie';
import styles from './LocationHint.module.css';

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function acknowledge(): void {
  try {
    document.cookie = `${LOCATION_ACK_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Куки запрещены — плашка спросит снова, не страшно.
  }
}

/**
 * Плашка «Это ваша локация?» при первом визите.
 *
 * Страну посетителя подсказывает прокси (`noova_geo`). Два случая:
 *  - страна определилась, она среди активных и отличается от адреса — спрашиваем,
 *    не показать ли её анкеты, либо остаться там, куда человек пришёл;
 *  - страну определить нельзя или её нет среди активных (выключена) — берём
 *    ту, что в ссылке (`/ru/nl` — Нидерланды), и просто просим подтвердить.
 *
 * Адрес никогда не подменяется молча: человек мог прийти по чужой ссылке, и
 * тихий редирект на «его» страну показал бы совсем не то, что он открыл.
 * Любой ответ, как и ручной выбор в шапке, запоминается — второй раз не спросим.
 */
export function LocationHint({
  cities,
  countries,
}: {
  cities: CityOption[];
  countries: CountryOption[];
}) {
  const t = useTranslations('cityPicker');
  const pathname = usePathname();
  const router = useRouter();

  // Куки читаются после гидрации: на сервере их нет, а страница кэшируется.
  const [ready, setReady] = useState(false);
  const [geo, setGeo] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    setGeo(readCookie(GEO_COOKIE));
    setAnswered(readCookie(LOCATION_ACK_COOKIE) !== null);
    setReady(true);
  }, []);

  const current = currentLocation(pathname, cities, countries);
  if (!ready || answered || !current) return null;

  const detected = geo ? countries.find((item) => item.code === geo) : undefined;
  const place = current.city
    ? `${current.city.name}, ${current.country.name}`
    : current.country.name;

  const close = () => {
    acknowledge();
    setAnswered(true);
  };

  // Определённая страна расходится с адресом — предлагаем перейти.
  if (detected && detected.code !== current.country.code) {
    return (
      <section className={styles.bar} aria-label={t('hintLabel')}>
        <div className={`container ${styles.inner}`}>
          <p className={styles.text}>{t('hintDetected', { country: detected.name })}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                close();
                router.push(`/${[detected.code.toLowerCase(), ...current.rest].join('/')}`);
              }}
            >
              {t('hintShow', { country: detected.name })}
            </button>
            <button type="button" className={styles.secondary} onClick={close}>
              {t('hintStay', { country: current.country.name })}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.bar} aria-label={t('hintLabel')}>
      <div className={`container ${styles.inner}`}>
        <p className={styles.text}>{t('hintCurrent', { place })}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={close}>
            {t('hintYes')}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => window.dispatchEvent(new Event(OPEN_LOCATION_EVENT))}
          >
            {t('hintChange')}
          </button>
        </div>
      </div>
    </section>
  );
}
