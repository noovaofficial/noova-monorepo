import { describe, expect, it } from 'vitest';
import { InsufficientBalanceError, nextBalance } from './wallet.js';

describe('баланс GlowCoin', () => {
  it('не уходит в минус', () => {
    // payments.md §4: списание сверх остатка отклоняется, а не создаёт долг.
    expect(() => nextBalance(100, -101)).toThrow(InsufficientBalanceError);
  });

  it('допускает списание в ноль и любое начисление', () => {
    expect(nextBalance(100, -100)).toBe(0);
    expect(nextBalance(0, 4500)).toBe(4500);
  });

  it('сообщает, сколько было и сколько просили', () => {
    // Сообщение для админа: «недостаточно» без чисел заставляет искать баланс отдельно.
    try {
      nextBalance(30, -50);
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientBalanceError);
      expect((error as InsufficientBalanceError).balance).toBe(30);
      expect((error as InsufficientBalanceError).requested).toBe(50);
    }
  });
});
