import { type BatchEvent, MAX_BATCH_EVENTS } from '@noova/shared';
import { getSessionId } from './session';

/**
 * Батчевый трекер (фаза 1.2 спеки): отдельный от `api.ts` модуль без
 * внешних зависимостей. `api.ts` шлёт просмотр анкеты, клик по контакту и
 * раскрытие сразу, по одному запросу на событие, — те события немногочисленны
 * и синхронны с действием (клик по номеру и антифрод раскрытия не должны
 * ждать пятисекундного окна). Здесь — заходы на страницы без анкеты,
 * открытие галереи, применение фильтра: событий на порядок больше, и
 * значение имеет только то, что они дойдут, а не когда именно.
 */

const ENDPOINT = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/e`;
const FLUSH_INTERVAL_MS = 5000;

const queue: BatchEvent[] = [];
let listenersAttached = false;

function send(events: BatchEvent[]): void {
  if (events.length === 0) return;
  const body = JSON.stringify(events);

  try {
    // `sendBeacon` первым: единственный способ, гарантированно переживающий
    // уход со страницы — обычный `fetch`, начатый в `pagehide`, браузер
    // волен просто не успеть отправить.
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.(ENDPOINT, blob)) return;
  } catch {
    // Недоступен или отверг тело — пробуем `fetch` ниже.
  }

  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      credentials: 'include',
      keepalive: true,
    });
  } catch {
    // Трекер не должен мешать странице — батч просто теряется.
  }
}

function flush(): void {
  // На случай, если очередь всё же переросла лимит одного запроса (сейчас
  // почти невозможно — три вида событий копятся максимум пять секунд) —
  // режем на части одного размера с сервером, а не роняем хвост целиком.
  while (queue.length > 0) send(queue.splice(0, MAX_BATCH_EVENTS));
}

function ensureListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  try {
    setInterval(flush, FLUSH_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  } catch {
    // Нет DOM (SSR, тесты) — нет и страницы, за которой следить.
  }
}

/**
 * Ставит событие в очередь. Ничего не бросает и не блокирует страницу:
 * трекер — гость на странице анкеты или каталога, а не наоборот.
 */
export function track(event: Omit<BatchEvent, 'sessionId' | 'clientTs'>): void {
  try {
    ensureListeners();
    queue.push({ ...event, sessionId: getSessionId(), clientTs: Date.now() });
    if (queue.length >= MAX_BATCH_EVENTS) flush();
  } catch {
    // См. комментарий у `track`.
  }
}
