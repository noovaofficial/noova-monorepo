import { getTranslations } from 'next-intl/server';
import styles from './Amenities.module.css';

/**
 * Удобства салона (N-34). Заголовок даёт секция снаружи: блок стоит в том же
 * ряду, что услуги и тарифы, и своего заголовка ему не нужно.
 */
export async function Amenities({ amenities, locale }: { amenities: string[]; locale: string }) {
  if (amenities.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'company' });

  return (
    <ul className={styles.chips}>
      {amenities.map((amenity) => (
        <li className={styles.chip} key={amenity}>
          {/* Ключа может не быть в словаре: набор удобств пополнится раньше
              переводов, и «sauna» лучше пустого места. */}
          {t.has(`amenity_${amenity}`) ? t(`amenity_${amenity}`) : amenity}
        </li>
      ))}
    </ul>
  );
}
