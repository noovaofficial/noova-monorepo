import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Logo } from '@/design-system/components/Logo';
import { fetchServiceCatalogPublic, safely } from '@/shared/api';
import { Link } from '@/shared/i18n/navigation';
import styles from '../Header.module.css';
import { HeaderActions } from '../HeaderActions';
import { HeaderFilters } from '../HeaderFilters';
import { LocaleSwitcher } from '../LocaleSwitcher';
import { QuickLinks } from '../QuickLinks';
import { ThemeToggle } from '../ThemeToggle';

/** Быстрые фильтры пока статичны: подключаются к состоянию каталога,
 *  когда появится страница листинга с фильтрами. */
/** Быстрые срезы каталога. Ведут на страницу листинга с готовым фильтром —
 *  раньше это были кнопки без действия. */
const QUICK_FILTERS = [
  { key: 'top', href: '/catalog/escort?featuredOnly=true' },
  { key: 'online', href: '/catalog/escort?onlineOnly=true' },
  { key: 'bdsm', href: '/catalog/escort?services=bondage&services=domination' },
  { key: 'massage', href: '/catalog/massage' },
] as const;

export async function Header() {
  // getTranslations, а не хук useTranslations: компонент асинхронный —
  // ему нужен справочник услуг с сервера, а хуки в async-компонентах нельзя.
  const t = await getTranslations('nav');
  const tf = await getTranslations('filters');

  // Справочник нужен панели фильтров в момент открытия. Тянем на сервере:
  // иначе первое нажатие показало бы пустые группы услуг.
  const catalog = await safely(fetchServiceCatalogPublic('escort'), [], 'headerCatalog');

  return (
    <header className={styles.header}>
      <a href="#main" className={styles.skip}>
        {t('skipToContent')}
      </a>
      <div className="container">
        <div className={`${styles.row} ${styles.row1}`}>
          <Link href="/" className={styles.logo}>
            <Logo />
          </Link>
          <div className={styles.actions}>
            <HeaderActions />
          </div>
        </div>

        <div className={`${styles.row} ${styles.row2}`}>
          <QuickLinks>
            {/* useSearchParams внутри требует границы Suspense: без неё
                статические страницы целиком уходят в клиентский рендер.

                Фолбэк повторяет обе кнопки, а не только «Фильтры»: иначе
                ссылки на карту нет в серверной разметке и она появляется
                рывком после гидрации. Здесь она без текущих фильтров —
                клиентская версия заменит её на ту, что их несёт. */}
            <Suspense
              fallback={
                <>
                  <span className={styles.filterBtn}>{t('filters')}</span>
                  <Link className={styles.filterBtn} href="/catalog/escort/map">
                    {t('mapView')}
                  </Link>
                </>
              }
            >
              <HeaderFilters catalog={catalog} />
            </Suspense>

            <div className={styles.quickFilters}>
              {QUICK_FILTERS.map((item) => (
                <Link key={item.key} href={item.href} className={styles.chip}>
                  {tf(item.key)}
                </Link>
              ))}
            </div>
          </QuickLinks>

          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
