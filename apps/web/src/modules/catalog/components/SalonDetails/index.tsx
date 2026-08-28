import type { Locale, ProfileDetail } from '@noova/shared';
import { getTranslations } from 'next-intl/server';
import styles from './SalonDetails.module.css';

/**
 * Что посетитель выясняет о салоне до визита (N-34): как добраться, нужна ли
 * запись, чем можно платить, на каких языках говорят, что есть в помещении и
 * сколько стоит.
 *
 * Всё это — свойства места, а не анкеты, поэтому у агентства блок пуст и не
 * отображается вовсе.
 */
export async function SalonDetails({
  profile,
  locale,
}: {
  profile: ProfileDetail;
  locale: Locale;
}) {
  // Салонные поля заполнены только у салона: у анкеты человека они пусты.
  const company = profile;

  const t = await getTranslations({ locale, namespace: 'company' });

  const facts: { label: string; value: string }[] = [];

  if (company.bookingPolicy) {
    facts.push({ label: t('booking'), value: t(`booking_${company.bookingPolicy}`) });
  }
  if (company.minSessionMinutes) {
    facts.push({
      label: t('minSession'),
      value: t('minutes', { count: company.minSessionMinutes }),
    });
  }

  // Прайс салона — это тарифы анкеты: отдельного списка нет, он уже на
  // странице в разделе «Тарифы».
  // Удобства, оплата и языки вынесены каждый в свою секцию на странице.
  // Здесь остаются маршрут и короткие факты о заведении.
  const hasAnything = facts.length > 0 || company.directions;
  if (!hasAnything) return null;

  return (
    <div className={styles.wrap}>
      {company.directions ? (
        <section className={styles.block}>
          <h2 className={styles.title}>{t('directions')}</h2>
          <p className={styles.text}>{company.directions}</p>
        </section>
      ) : null}

      {facts.length > 0 ? (
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div className={styles.fact} key={fact.label}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
