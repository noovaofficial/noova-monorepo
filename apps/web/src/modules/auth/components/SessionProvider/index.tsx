'use client';

import type { CurrentUser } from '@noova/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect } from 'react';
import { fetchCurrentUser, logout as logoutRequest } from '@/modules/auth/api';
import {
  applyStoredSessionHint,
  clearSessionHint,
  setSessionHint,
} from '@/modules/auth/session-hint';
import { queryKeys } from '@/shared/query-keys';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

type SessionValue = {
  user: CurrentUser | null;
  status: SessionStatus;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: queryKeys.session(),
    queryFn: async () => {
      const current = await fetchCurrentUser();
      // Кука-подсказка могла протухнуть вместе с сессией — держим их в согласии,
      // иначе шапка будет показывать вход после того, как сессия истекла.
      if (current) setSessionHint();
      else clearSessionHint();
      return current;
    },
    // Сессия одна на всё приложение: без Query каждый экран, которому нужна
    // роль, слал бы свой запрос к /auth/me.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    // Смена языка перемонтирует layout и атрибуты теряются — возвращаем их
    // до запроса, иначе разметка на мгновение станет «гостевой».
    applyStoredSessionHint();
  }, []);

  const user = session.data ?? null;
  const status: SessionStatus = session.isPending
    ? 'loading'
    : user
      ? 'authenticated'
      : 'anonymous';

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // Чистим кэш целиком, а не только сессию: в нём лежат избранное,
      // очередь модерации, анкеты — данные вышедшего пользователя не должны
      // достаться следующему, кто войдёт в этой же вкладке.
      clearSessionHint();
      // Порядок важен: `clear()` стёр бы и только что записанный null,
      // и экран на мгновение вернулся бы в состояние «загружаем».
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), null);
    }
  }, [queryClient]);

  return (
    <SessionContext.Provider value={{ user, status, refresh, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession вызван вне SessionProvider');
  return value;
}
