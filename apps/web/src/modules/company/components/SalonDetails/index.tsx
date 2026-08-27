import type { Company } from '@noova/shared';
import { getTranslations } from 'next-intl/server';
import { formatMoney } from '@/shared/format';
import styles from './SalonDetails.module.css';

/**
 * Что посетитель выясняет о салоне до визита (N-34): как добраться, нужна ли
 * запись, чем можно платить, на каких языках говорят, что есть в помещении и
 * сколько стоит.
 *
 * Всё это — свойства места, а не анкеты, поэтому у агентства блок пуст и не
 * отображается вовсе.
 */
export async function SalonDetails({ company, locale }: { company: Company; locale: string }) {
  if (company.kind !== 'salon') return null;

  const t = await getTranslations({ locale, namespace: 'company' });
  const tLang = await getTranslations({ locale, namespace: 'languageNames' });

  const facts: { label: string; value: string }[] = [];

  if (company.bookingPolicy) {
    facts.push({ label: t('booking'), value: t(`booking_${company.bookingPolicy}`) });
  }
  if (company.minSessionMinutes) {
    facts.push({ label: t('minSession'), value: t('minutes', { count: company.minSessionMinutes }) });
  }
  if (company.payments.length > 0) {
    facts.push({
      label: t('payments'),
      value: company.payments.map((p) => t(`payment_${p}`)).join(', '),
    });
  }
  if (company.languages.length > 0) {
    facts.push({
      label: t('languages'),
      // Код, которого нет в словаре, показываем как есть: список языков
      // может пополниться раньше переводов.
      value: company.languages.map((l) => (tLang.has(l) ? tLang(l) : l)).join(', '),
    });
  }

  const hasAnything =
    facts.length > 0 ||
    company.directions ||
    company.amenities.length > 0 ||
    company.prices.length > 0;
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

      {company.amenities.length > 0 ? (
        <section className={styles.block}>
          <h2 className={styles.title}>{t('amenities')}</h2>
          <ul className={styles.chips}>
            {company.amenities.map((amenity) => (
              <li className={styles.chip} key={amenity}>
                {t.has(`amenity_${amenity}`) ? t(`amenity_${amenity}`) : amenity}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {company.prices.length > 0 ? (
        <section className={styles.block}>
          <h2 className={styles.title}>{t('prices')}</h2>
          <ul className={styles.prices}>
            {company.prices.map((price) => (
              <li className={styles.price} key={`${price.title}-${price.durationMinutes}`}>
                <span>{price.title}</span>
                <span className={styles.priceMeta}>
                  {t('minutes', { count: price.durationMinutes })}
                  {' · '}
                  <strong>{formatMoney({ amountCents: price.priceCents, currency: 'EUR' }, locale)}</strong>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
