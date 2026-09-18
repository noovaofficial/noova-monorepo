'use client';

import type { CityOption, CountryOption } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import styles from './CitySwitcher.module.css';

/** Слуг города пустым не бывает — этим значением помечен пункт «Все города». */
const ALL_CITIES = '';

/**
 * Переключатель города в шапке.
 *
 * Показывается только на витринных страницах — там, где в адресе есть город
 * или код страны (N-42): главная (города или всей страны), каталог, карта.
 * На анкете, в кабинете и в админке он скрыт: менять там город бессмысленно,
 * а элемент, молча уводящий на другую страницу, дезориентирует (N-32).
 *
 * Список городов — только текущей страны: слева свой свитч для страны
 * (`CountrySwitcher`), и мешать в одном списке Берлин с Амстердамом незачем.
 *
 * «Все города» есть везде, где есть сам свитч: у главной, каталога и карты
 * теперь одинаково есть срез «вся страна» (N-43), и хвост пути (`/catalog/
 * escort`, `/catalog/escort/map`) сохраняется тем же образом, что и при
 * выборе конкретного города.
 *
 * Выбор города (как и «Все города») сохраняет страницу: из каталога массажа
 * одного города попадаешь в каталог массажа другого или всей страны, а не
 * на чью-то главную.
 *
 * На телефоне вместо названия — значок метки. Название занимало место,
 * которого в строке нет, но сам `select` остаётся на месте и прозрачным
 * лежит поверх значка: нажатие открывает тот же родной список системы.
 * Подменять его своим меню значило бы потерять привычное поведение —
 * колесо на iOS, поиск с клавиатуры на Android.
 */
export function CitySwitcher({
  cities,
  countries,
}: {
  cities: CityOption[];
  countries: CountryOption[];
}) {
  const t = useTranslations('cityPicker');
  const pathname = usePathname();
  const router = useRouter();

  // pathname здесь без языкового префикса — его снимает обёртка next-intl.
  const [, first = '', ...rest] = pathname.split('/');
  const currentCity = cities.find((city) => city.slug === first);
  const currentCountryCode =
    currentCity?.country.code ??
    countries.find((country) => country.code.toLowerCase() === first.toLowerCase())?.code;

  // Ни город, ни код страны — страница вне витрины. Ничего не показываем.
  if (!currentCountryCode) return null;

  const countryCities = cities.filter((city) => city.country.code === currentCountryCode);
  // +1 — сама опция «Все города», она теперь есть всегда.
  if (countryCities.length + 1 < 2) return null;

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
        value={currentCity ? currentCity.slug : ALL_CITIES}
        onChange={(event) => {
          const target =
            event.target.value === ALL_CITIES
              ? currentCountryCode.toLowerCase()
              : event.target.value;
          router.push(`/${[target, ...rest].join('/')}`);
        }}
      >
        <option value={ALL_CITIES}>{t('allCities')}</option>
        {countryCities.map((city) => (
          <option key={city.slug} value={city.slug}>
            {city.name}
          </option>
        ))}
      </select>
    </label>
  );
}
