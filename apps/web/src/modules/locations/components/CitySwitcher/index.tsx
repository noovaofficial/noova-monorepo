'use client';

import type { CityOption } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import styles from './CitySwitcher.module.css';

/**
 * Переключатель города в шапке.
 *
 * Показывается только на витринных страницах — там, где город есть в адресе:
 * главная города, каталог, карта. На анкете, в кабинете и в админке он скрыт:
 * менять там город бессмысленно, а элемент, молча уводящий на другую
 * страницу, дезориентирует (N-32).
 *
 * Выбор города сохраняет страницу: из каталога массажа одного города
 * попадаешь в каталог массажа другого, а не на его главную.
 *
 * На телефоне вместо названия города — значок метки. Название занимало
 * место, которого в строке нет, но сам `select` остаётся на месте и
 * прозрачным лежит поверх значка: нажатие открывает тот же родной список
 * системы. Подменять его своим меню значило бы потерять привычное
 * поведение — колесо на iOS, поиск с клавиатуры на Android.
 */
export function CitySwitcher({ cities }: { cities: CityOption[] }) {
  const t = useTranslations('cityPicker');
  const pathname = usePathname();
  const router = useRouter();

  // pathname здесь без языкового префикса — его снимает обёртка next-intl.
  const [, first = '', ...rest] = pathname.split('/');
  const current = cities.find((city) => city.slug === first);

  // Города в адресе нет — страница негородская. Ничего не показываем.
  if (!current || cities.length < 2) return null;

  return (
    <label className={styles.wrap}>
      <span className="visually-hidden">{t('switchLabel')}</span>

      {/* Значок виден только на телефоне; на широком экране его прячет CSS,
          и город снова читается словом. */}
      <span className={styles.pin}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </span>

      <select
        className={styles.select}
        value={current.slug}
        onChange={(event) => router.push(`/${[event.target.value, ...rest].join('/')}`)}
      >
        {cities.map((city) => (
          <option key={city.slug} value={city.slug}>
            {city.name}
          </option>
        ))}
      </select>
    </label>
  );
}
