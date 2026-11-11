import { useTranslations } from 'next-intl';
import { Link } from '@/shared/i18n/navigation';
import styles from '../ProfileGrid.module.css';

/** Город, в котором пусто, и куда вести — на ту же выдачу, но по всей стране. */
export type EmptyCity = { cityName: string; countryName: string; countryHref: string };

/**
 * Пустая выдача. В городе без анкет пустой экран с советом «уберите
 * фильтры» ничего не даёт — человеку нужно понять, что пусто именно в этом
 * городе, и одним нажатием посмотреть страну целиком.
 */
export function EmptyResults({ city }: { city?: EmptyCity }) {
  const t = useTranslations('home');
  const tp = useTranslations('cityPicker');

  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{t('empty')}</p>
      {city ? (
        <>
          <p>{tp('emptyInCity', { city: city.cityName })}</p>
          <p>
            <Link href={city.countryHref}>
              {tp.rich('emptySeeCountry', {
                country: city.countryName,
                accent: (chunks) => <span className={styles.accent}>{chunks}</span>,
              })}
            </Link>
          </p>
        </>
      ) : null}
      <p>{t('emptyHint')}</p>
    </div>
  );
}
