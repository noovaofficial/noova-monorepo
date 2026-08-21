'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext } from 'react';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { addFavorite, fetchFavoriteIds, removeFavorite } from '@/modules/favorites/api';
import { queryKeys } from '@/shared/query-keys';

type FavoritesValue = {
  /** null — состояние ещё не известно: сердце рисуем нейтральным, а не пустым. */
  ids: Set<string> | null;
  isClient: boolean;
  toggle: (profileId: string) => Promise<void>;
};

const FavoritesContext = createContext<FavoritesValue | null>(null);

/**
 * Намерение, не пережившее вход. Гость нажал сердце, ушёл на форму входа —
 * после возвращения отметка должна появиться сама. Терять действие молча
 * значит заставлять человека искать ту же анкету заново.
 *
 * sessionStorage, а не localStorage: намерение живёт до конца вкладки.
 * Зависшее в localStorage на неделю сердце всплыло бы неожиданно.
 */
const PENDING_KEY = 'noova_pending_favorite';

export function rememberPendingFavorite(profileId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, profileId);
  } catch {
    // Приватный режим может запрещать хранилище. Потерять намерение здесь
    // не страшно — это удобство, а не функция.
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user, status } = useSession();
  const queryClient = useQueryClient();

  const isClient = user?.role === 'client';

  const { data: ids = null } = useQuery({
    queryKey: queryKeys.favoriteIds(),
    queryFn: async () => {
      const loaded = new Set(await fetchFavoriteIds());

      // Действие, отложенное до входа, применяем ровно один раз — прямо
      // здесь, чтобы к первому рендеру сердце было уже закрашено.
      let pendingId: string | null = null;
      try {
        pendingId = sessionStorage.getItem(PENDING_KEY);
        if (pendingId) sessionStorage.removeItem(PENDING_KEY);
      } catch {
        pendingId = null;
      }

      if (pendingId && !loaded.has(pendingId)) {
        try {
          await addFavorite(pendingId);
          loaded.add(pendingId);
        } catch {
          // Анкету могли снять с публикации, пока человек входил.
        }
      }

      return loaded;
    },
    // Выход или смена роли гасит запрос, и `data` снова становится null:
    // состояние прошлого пользователя не остаётся на экране.
    enabled: status !== 'loading' && isClient,
  });

  const toggle = useMutation({
    mutationFn: async (profileId: string) => {
      const current = queryClient.getQueryData<Set<string>>(queryKeys.favoriteIds());
      if (current?.has(profileId)) await removeFavorite(profileId);
      else await addFavorite(profileId);
    },
    // Оптимистично: сердце должно откликаться мгновенно, сеть здесь ни при
    // чём. При отказе возвращаем ровно тот снимок, что был до нажатия.
    onMutate: async (profileId: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.favoriteIds() });
      const previous = queryClient.getQueryData<Set<string>>(queryKeys.favoriteIds());

      const next = new Set(previous ?? []);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      queryClient.setQueryData(queryKeys.favoriteIds(), next);

      return { previous };
    },
    onError: (_error, _profileId, context) => {
      queryClient.setQueryData(queryKeys.favoriteIds(), context?.previous ?? null);
    },
    onSettled: () => {
      // Страница избранного показывает карточки, а не идентификаторы:
      // её список тоже устарел.
      void queryClient.invalidateQueries({ queryKey: queryKeys.favorites() });
    },
  });

  const toggleFavorite = useCallback(
    async (profileId: string) => {
      await toggle.mutateAsync(profileId).catch(() => undefined);
    },
    [toggle],
  );

  return (
    <FavoritesContext.Provider value={{ ids, isClient, toggle: toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error('useFavorites вызван вне FavoritesProvider');
  return value;
}
