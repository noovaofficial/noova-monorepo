import { describe, expect, it } from 'vitest';

/**
 * Правило видимости кнопки «Отправить на проверку» и запрета на сервере.
 * Вынесено отдельно, потому что ошибка здесь стоит дорого: повторная
 * отправка переводит заявку в `pending`, то есть уже проверенная владелица
 * теряет статус и возвращается в очередь.
 */
function canSubmit(status: string, verification: string): boolean {
  if (status === 'banned') return true;
  if (verification === 'verified') return false;
  return status === 'draft' || status === 'rejected';
}

describe('повторная отправка на проверку', () => {
  it('запрещена после пройденной верификации', () => {
    // Именно этот случай сбивал с толку: анкету остаётся только опубликовать,
    // а кнопка предлагала действие, которое откатывало проверку.
    expect(canSubmit('draft', 'verified')).toBe(false);
    expect(canSubmit('paused', 'verified')).toBe(false);
    expect(canSubmit('published', 'verified')).toBe(false);
  });

  it('разрешена, пока верификация не пройдена', () => {
    expect(canSubmit('draft', 'none')).toBe(true);
    expect(canSubmit('rejected', 'rejected')).toBe(true);
  });

  it('разрешена для заблокированной анкеты даже после верификации', () => {
    // Там повторная проверка и есть смысл действия: в очередь анкета
    // попадает именно через сброс заявки в `pending`.
    expect(canSubmit('banned', 'verified')).toBe(true);
  });

  it('не разрешена из состояний, где отправлять нечего', () => {
    expect(canSubmit('pending_verification', 'pending')).toBe(false);
    expect(canSubmit('published', 'verified')).toBe(false);
  });
});
