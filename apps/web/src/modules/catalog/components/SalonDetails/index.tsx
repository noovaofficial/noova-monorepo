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
  const tLang = await getTranslations({ locale, namespace: 'languageNames' });

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
  if (company.params.languages.length > 0) {
    facts.push({
      label: t('languages'),
      // Код, которого нет в словаре, показываем как есть: список языков
      // может пополниться раньше переводов.
      value: company.params.languages.map((l) => (tLang.has(l) ? tLang(l) : l)).join(', '),
    });
  }

  // Прайс салона — это тарифы анкеты: отдельного списка нет, он уже на
  // странице в разделе «Тарифы».
  // Удобства вынесены в свою секцию после услуг, оплата — в свою между
  // контактами и тарифами. Здесь остаются маршрут и короткие факты.
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
