'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import { rememberPendingFavorite, useFavorites } from '../FavoritesProvider';
import styles from './FavoriteButton.module.css';

type Props = {
  profileId: string;
  /** Развёрнутый вид с подписью — для страницы анкеты. */
  withLabel?: boolean;
  className?: string;
};

export function FavoriteButton({ profileId, withLabel = false, className }: Props) {
  const t = useTranslations('favorites');
  const { status, user } = useSession();
  const { ids, toggle } = useFavorites();
  const router = useRouter();
  const pathname = usePathname();

  // Рекламодателю и персоналу сердце не показываем: API им откажет, и кнопка,
  // которая всегда не работает, хуже её отсутствия. Гостю показываем —
  // для него это приглашение войти.
  if (status === 'authenticated' && user?.role !== 'client') return null;

  const isOn = ids?.has(profileId) ?? false;

  async function onClick(event: React.MouseEvent) {
    // Кнопка лежит поверх ссылки-карточки: без остановки всплытия нажатие
    // на сердце уводило бы на страницу анкеты.
    event.preventDefault();
    event.stopPropagation();

    if (status !== 'authenticated') {
      // Намерение сохраняем до входа и применяем после — иначе действие
      // теряется, и человек ищет ту же анкету заново.
      rememberPendingFavorite(profileId);
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    await toggle(profileId);
  }

  return (
    <button
      type="button"
      className={[styles.btn, withLabel && styles.inline, isOn && styles.on, className]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      aria-pressed={isOn}
      aria-label={isOn ? t('remove') : t('add')}
      title={isOn ? t('remove') : t('add')}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        // Заливка появляется только у отмеченного: контур и заливка различимы
        // и без цвета, а значит и при дальтонизме.
        fill={isOn ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
      {withLabel ? <span>{isOn ? t('saved') : t('add')}</span> : null}
    </button>
  );
}
