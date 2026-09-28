/**
 * Сигналы для антибот-правил 3 и 4 (фаза 3 спеки): было ли на странице
 * взаимодействие до контактного события и сколько прошло с её загрузки.
 * Состояние модульное, а не в React: сбрасывается явным вызовом
 * `markPageLoaded` при заходе на новую анкету, а не перемонтированием
 * компонента, которого клиентская навигация не гарантирует.
 *
 * Ничего не бросает: без DOM (SSR, тесты) слушать нечего, и это не ошибка.
 */
let loadedAt = 0;
let interacted = false;
let listenersAttached = false;

const INTERACTION_EVENTS = ['scroll', 'pointerdown', 'touchstart'] as const;

function attachListenersOnce(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  try {
    const mark = () => {
      interacted = true;
    };
    for (const type of INTERACTION_EVENTS) {
      window.addEventListener(type, mark, { passive: true });
    }
  } catch {
    // Нет window — нет и взаимодействия, которое можно было бы слушать.
  }
}

/** Вызывается на каждой новой анкете: новый отсчёт времени и взаимодействия. */
export function markPageLoaded(): void {
  attachListenersOnce();
  loadedAt = Date.now();
  interacted = false;
}

/** Что приложить к контактному событию текущей страницы. */
export function interactionSignals(): { interacted: boolean; msSincePageLoad: number } {
  return { interacted, msSincePageLoad: loadedAt ? Date.now() - loadedAt : 0 };
}
