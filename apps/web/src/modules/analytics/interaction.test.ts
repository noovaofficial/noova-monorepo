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

  it('считает миллисекунды с загрузки', async () => {
    markPageLoaded();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(interactionSignals().msSincePageLoad).toBeGreaterThanOrEqual(5);
  });
});
