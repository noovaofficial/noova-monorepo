import { useTranslations } from 'next-intl';
import { Logo } from '@/design-system/components/Logo';
import { Link } from '@/shared/i18n/navigation';
import styles from './Footer.module.css';

/**
 * «О верификации» временно убрана: пока публикуются только девушки,
 * проверенные агентством, страница обещала бы собственную процедуру
 * проверки, которой нет (L-02 в documentation/legal.md).
 */
const COMPANY_LINKS = [
  { key: 'linkAbout', href: '/about' },
  { key: 'linkAds', href: '/advertising' },
  { key: 'linkContacts', href: '/contact' },
] as const;

/**
 * Правовые ссылки временно убраны из футера — решение владельца продукта.
 *
 * Причина: страниц ещё нет (N-03 отложена до согласования с юристом), а
 * ссылки вели в 404. Мёртвая ссылка на `Impressum` хуже её отсутствия:
 * первое читается как небрежность к обязательному требованию, второе —
 * как «раздел ещё не открыт».
 *
 * **Вернуть обязательно до публичного запуска.** `Impressum`, `Datenschutz`
 * и `AGB` обязательны на рынке Германии; их отсутствие — основание для
 * Abmahnung. Задача и сроки — в documentation/legal.md.
 */

export function Footer() {
  const t = useTranslations('footer');

  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.grid}>
          <div>
            <Link href="/" className={styles.logo}>
              <Logo />
            </Link>
            <p className={styles.about}>{t('about')}</p>
            <span className={styles.age}>🔞 {t('adultsOnly')}</span>
          </div>

          <div>
            <h2 className={styles.colTitle}>{t('company')}</h2>
            <ul className={styles.list}>
              {COMPANY_LINKS.map(({ key, href }) => (
                <li key={key}>
                  <Link href={href}>{t(key)}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={styles.bottom}>
          <span>{t('copyright', { year: new Date().getFullYear() })}</span>
        </div>
      </div>
    </footer>
  );
}
