'use client';

import { useEffect } from 'react';
import { trackSession } from '@/modules/analytics/api';
import {
  buildSessionPayload,
  getSessionId,
  shouldAnnounceSession,
} from '@/modules/analytics/session';

/**
 * Сообщает серверу о начале сессии: откуда пришёл посетитель. Ничего не
 * рисует. Срабатывает на первой странице сессии; переходы внутри сайта
 * источник не меняют. Метки читаются из адресной строки в момент захода —
 * страницы кэшируются, и на сервере их не видно.
 */
export function SessionTracker() {
  useEffect(() => {
    if (!shouldAnnounceSession()) return;
    void trackSession(buildSessionPayload(getSessionId(), window.location, document.referrer));
  }, []);

  return null;
}
