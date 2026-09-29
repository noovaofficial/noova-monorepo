// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interactionSignals, markPageLoaded } from './interaction';

describe('interactionSignals', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('без взаимодействия остаётся false', () => {
    markPageLoaded();
    expect(interactionSignals().interacted).toBe(false);
  });

  it('scroll, pointerdown и touchstart отмечают взаимодействие', () => {
    for (const type of ['scroll', 'pointerdown', 'touchstart'] as const) {
      markPageLoaded();
      expect(interactionSignals().interacted).toBe(false);
      window.dispatchEvent(new Event(type));
      expect(interactionSignals().interacted).toBe(true);
    }
  });

  it('новая страница сбрасывает взаимодействие прошлой', () => {
    markPageLoaded();
    window.dispatchEvent(new Event('scroll'));
    expect(interactionSignals().interacted).toBe(true);

    markPageLoaded();
    expect(interactionSignals().interacted).toBe(false);
  });

  it('считает миллисекунды с загрузки', () => {
    // Фейковые часы: реальный setTimeout(5) иногда просыпается, когда
    // Date.now() сдвинулся лишь на 4 мс, — тест падал через раз.
    vi.useFakeTimers();
    markPageLoaded();
    vi.advanceTimersByTime(5);
    expect(interactionSignals().msSincePageLoad).toBe(5);
  });
});
