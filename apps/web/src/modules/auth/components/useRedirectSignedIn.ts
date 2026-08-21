'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useRouter } from '@/shared/i18n/navigation';
import { useSession } from './SessionProvider';

/**
 * Куда возвращать после входа. Значение приходит из адресной строки, а её
 * задаёт кто угодно — поэтому пускаем только относительный путь внутри сайта.
 * `//evil.com` и `https://evil.com` — оба открытые редиректы: первый браузер
 * читает как протокол-относительный адрес, поэтому одной проверки на `/` мало.
 */
export function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // Обратный слэш некоторые браузеры нормализуют в прямой: `/\evil.com`.
  if (raw.startsWith('/\\')) return null;
  return raw;
}

/**
 * Вошедшему на форме входа делать нечего. Проверяем по сессии, а не по
 * куке-подсказке: кука может пережить отозванную сессию, и тогда человек
 * с забаненной учёткой не смог бы дойти до формы, чтобы войти заново.
 *
 * Возвращает `true`, только когда вход подтверждён: пока `/auth/me` не
 * ответил, форму продолжаем показывать. Подавляющее большинство здесь —
 * гости, и заставлять их смотреть на «загружаем…» ради редкого случая
 * вошедшего значит замедлить всех ради одного.
 */
export function useRedirectSignedIn(): boolean {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    if (status !== 'authenticated') return;
    // replace, а не push: возврат «назад» не должен приводить обратно на форму.
    router.replace(safeNext(params.get('next')) ?? '/');
  }, [status, router, params]);

  return status === 'authenticated';
}
