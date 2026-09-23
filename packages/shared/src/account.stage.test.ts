import { describe, expect, it } from 'vitest';
import { isProfileComplete, isReadyToSubmit, profileStage } from './account';

const full = { age: 25, photosCount: 3, pricesCount: 2, contactsCount: 1 };

describe('заполненность анкеты', () => {
  it('нужны возраст, фото, тариф и контакт', () => {
    expect(isProfileComplete(full)).toBe(true);
    expect(isProfileComplete({ ...full, age: null })).toBe(false);
    expect(isProfileComplete({ ...full, photosCount: 0 })).toBe(false);
    expect(isProfileComplete({ ...full, pricesCount: 0 })).toBe(false);
    expect(isProfileComplete({ ...full, contactsCount: 0 })).toBe(false);
  });
});

describe('стадии анкеты', () => {
  const at = (
    status: Parameters<typeof profileStage>[0]['status'],
    verificationStatus: Parameters<typeof profileStage>[0]['verificationStatus'],
    extra = {},
  ) => profileStage({ ...full, status, verificationStatus, ...extra });

  it('пустой черновик и заполненный черновик — разные стадии', () => {
    expect(at('draft', 'none', { photosCount: 0 })).toBe('draft');
    expect(at('draft', 'none')).toBe('ready_for_review');
  });
  it('на проверке, проверена, опубликована', () => {
    expect(at('pending_verification', 'pending')).toBe('in_review');
    expect(at('draft', 'verified')).toBe('ready_for_publication');
    expect(at('published', 'verified')).toBe('published');
  });
  it('пауза, отказ, блокировка остаются отдельными', () => {
    expect(at('paused', 'verified')).toBe('paused');
    expect(at('rejected', 'failed')).toBe('rejected');
    expect(at('banned', 'verified')).toBe('banned');
  });
});

describe('можно ли отправить на проверку', () => {
  const ready = (
    status: Parameters<typeof isReadyToSubmit>[0]['status'],
    verificationStatus: Parameters<typeof isReadyToSubmit>[0]['verificationStatus'],
    extra = {},
  ) => isReadyToSubmit({ ...full, status, verificationStatus, ...extra });

  it('да: заполненный черновик или отклонённая', () => {
    expect(ready('draft', 'none')).toBe(true);
    expect(ready('rejected', 'failed')).toBe(true);
  });
  it('нет: пустая, уже проверена, на проверке, опубликована, заблокирована', () => {
    expect(ready('draft', 'none', { photosCount: 0 })).toBe(false);
    expect(ready('draft', 'verified')).toBe(false);
    expect(ready('pending_verification', 'pending')).toBe(false);
    expect(ready('published', 'verified')).toBe(false);
    expect(ready('banned', 'none')).toBe(false);
  });
});

describe('салон', () => {
  it('под правило заполненности не подпадает', () => {
    const empty = {
      kind: 'massage' as const,
      age: null,
      photosCount: 0,
      pricesCount: 0,
      contactsCount: 0,
    };
    expect(isProfileComplete(empty)).toBe(true);
  });
});
