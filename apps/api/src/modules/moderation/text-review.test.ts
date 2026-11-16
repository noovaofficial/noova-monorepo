import { describe, expect, it } from 'vitest';
import { isTextReviewed, textReviewStep } from './text-review.js';

const approved = { displayName: 'Анна', description: 'Привет' };
const open = { previousDisplayName: 'Анна', previousDescription: 'Привет' };

describe('проверка правок текста опубликованной анкеты', () => {
  it('одобренной считается анкета в каталоге, снятая владельцем или прошедшая проверку', () => {
    expect(isTextReviewed('published', 'verified')).toBe(true);
    expect(isTextReviewed('paused', 'verified')).toBe(true);
    expect(isTextReviewed('draft', 'verified')).toBe(true);
    expect(isTextReviewed('draft', 'none')).toBe(false);
    expect(isTextReviewed('pending_verification', 'pending')).toBe(false);
    expect(isTextReviewed('rejected', 'rejected')).toBe(false);
    expect(isTextReviewed('banned', 'verified')).toBe(false);
  });

  it('правка ещё не одобренной анкеты в очередь не попадает', () => {
    expect(textReviewStep(false, approved, { ...approved, displayName: 'Яна' }, null)).toBe('none');
  });

  it('правка имени или описания опубликованной анкеты открывает проверку', () => {
    expect(textReviewStep(true, approved, { ...approved, displayName: 'Яна' }, null)).toBe('open');
    expect(textReviewStep(true, approved, { ...approved, description: 'Пока' }, null)).toBe('open');
  });

  it('сохранение без изменения текста проверку не открывает', () => {
    expect(textReviewStep(true, approved, { ...approved }, null)).toBe('none');
  });

  it('вторая правка подряд остаётся той же проверкой', () => {
    const current = { displayName: 'Яна', description: 'Привет' };
    expect(textReviewStep(true, current, { ...current, description: 'Ещё' }, open)).toBe('keep');
  });

  it('возврат к одобренному тексту закрывает проверку', () => {
    const current = { displayName: 'Яна', description: 'Привет' };
    expect(textReviewStep(true, current, { ...approved }, open)).toBe('close');
  });

  it('сравнивает с одобренным текстом, а не с предыдущим сохранением', () => {
    // Текст в базе уже «Яна»; повторное сохранение того же — всё ещё правка
    // относительно одобренного «Анна».
    const current = { displayName: 'Яна', description: 'Привет' };
    expect(textReviewStep(true, current, { ...current }, open)).toBe('keep');
  });
});
