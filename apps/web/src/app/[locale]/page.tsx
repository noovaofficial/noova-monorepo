import type { Locale } from '@noova/shared';
import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { resolveHome } from '@/shared/city';
import { LOCATION_COOKIE } from '@/shared/location-cookie';
import styles from './cities.module.css';

type Props = { params: Promise<{ locale: Locale }> };

/**
 * Адрес без города — больше не страница выбора (N-42): она только
 * редиректит, никогда не рендерит контент сама. Иначе у одного и того же
 * контента (страна по умолчанию) было бы два индексируемых адреса — этот
 * и `/{locale}/{country}` — и оба спорили бы за выдачу.
 *
 * Куда именно — решает `resolveHome`: на запомненный город/страну из cookie
 * или на страну по умолчанию, если cookie нет или её значение уже не активно.
 *
 * Страница остаётся динамической (без `revalidate`): она читает cookie
 * конкретного посетителя, и один закэшированный редирект не должен
 * «утечь» на всех остальных.
 */
export default async function RootPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const remembered = (await cookies()).get(LOCATION_COOKIE)?.value;
  await resolveHome(locale, remembered);

  // Сюда попадаем, только если в базе нет ни одной активной страны —
  // пустое или не засеянное окружение. Показывать больше нечего.
  const t = await getTranslations({ locale, namespace: 'cityPicker' });
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.empty}>{t('empty')}</p>
    </div>
  );
}
