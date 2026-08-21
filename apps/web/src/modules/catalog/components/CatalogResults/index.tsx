'use client';

import type { Locale, ProfileCard as ProfileCardData } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { fetchProfilesClient } from '@/modules/catalog/api';
import { Link } from '@/shared/i18n/navigation';
import { ProfileCard } from '../ProfileCard';
import gridStyles from '../ProfileGrid.module.css';
import styles from './CatalogResults.module.css';

type Props = {
  locale: Locale;
  initialItems: ProfileCardData[];
  initialCursor: string | null;
  query: string;
  total: number;
  basePath: string;
  pageSize: number;
  /** Номер страницы, отрисованной сервером. */
};

/**
 * Выдача каталога с подгрузкой.
 *
 * Сетка одна на все карточки: если отрисованное сервером и догруженное
 * разложить по двум контейнерам, между ними появится шов и ряды разъедутся.
 * Поэтому список живёт в состоянии, а сервер лишь задаёт его начальное
 * значение — страница при этом остаётся серверно отрисованной, и бот
 * получает первые карточки в HTML.
 *
 * Подгрузка идёт по курсору, а не по номеру страницы: при добавлении анкеты
 * смещение съезжает, и человек увидел бы карточку дважды или пропустил её.
 *
 * «Показать ещё» — настоящая ссылка на следующую страницу, а не кнопка.
 * Бот по ней переходит и обходит весь каталог; браузер перехватывает клик
 * и дописывает карточки на месте. Отдельный ряд «предыдущая / следующая»
 * при этом не нужен — он дублировал бы то же самое для человека.
 */
export function CatalogResults({
  locale,
  initialItems,
  initialCursor,
  query,
  total,
  basePath,
  pageSize,
}: Props) {
  const t = useTranslations('filters');
  const [items, setItems] = useState(initialItems);
  // Страница из URL нужна только на первом рендере: дальше счёт ведётся
  // по числу показанных карточек.
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setPending(true);
    setFailed(false);
    try {
      const page = await fetchProfilesClient(query, cursor);
      // Защита от дублей: повторное нажатие или гонка не должны множить карточки.
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const hasMore = cursor !== null && items.length < total;

  // Адрес следующей страницы считаем от того, сколько уже показано: после
  // двух подгрузок ссылка должна вести на третью страницу, а не на вторую.
  const nextHref = () => {
    const params = new URLSearchParams(query);
    params.set('page', String(Math.floor(items.length / pageSize) + 1));
    return `${basePath}?${params.toString()}`;
  };

  return (
    <>
      <div className={gridStyles.grid}>
        {items.map((profile, index) => (
          <ProfileCard key={profile.id} profile={profile} locale={locale} priority={index < 5} />
        ))}
      </div>

      {hasMore ? (
        <div className={styles.wrap}>
          {failed ? <span className={styles.error}>{t('loadFailed')}</span> : null}
          <Link
            className={styles.more}
            href={nextHref()}
            rel="next"
            aria-busy={pending}
            onClick={(event) => {
              // Перехватываем только обычный клик: Ctrl, Shift и средняя
              // кнопка должны открывать страницу так, как ожидает человек.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              void loadMore();
            }}
          >
            {pending ? t('loading') : t('loadMore')}
          </Link>
          <span className={styles.status}>
            {items.length} / {total}
          </span>
        </div>
      ) : null}
    </>
  );
}
