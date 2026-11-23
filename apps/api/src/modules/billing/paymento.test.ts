import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPayment,
  httpsOnly,
  isValidSignature,
  mapOrderStatus,
  PaymentoError,
  parseCallback,
  signatureFor,
} from './paymento.js';

describe('подпись колбэка Paymento', () => {
  const secret = 'test-secret';
  const body = '{"Token":"abc","OrderId":"o1","OrderStatus":7}';

  it('принимает подпись сырого тела в любом регистре', () => {
    const upper = signatureFor(body, secret);
    expect(isValidSignature(body, upper, secret)).toBe(true);
    expect(isValidSignature(body, upper.toLowerCase(), secret)).toBe(true);
  });

  it('отклоняет чужую подпись, изменённое тело и пустой секрет', () => {
    const sig = signatureFor(body, secret);
    expect(isValidSignature(body, signatureFor(body, 'other'), secret)).toBe(false);
    expect(isValidSignature(`${body} `, sig, secret)).toBe(false);
    expect(isValidSignature(body, undefined, secret)).toBe(false);
    // Пустой секрет — касса не настроена; «подписать» пустым ключом может
    // кто угодно, и такой колбэк не должен проходить.
    expect(isValidSignature(body, signatureFor(body, ''), '')).toBe(false);
  });
});

describe('разбор колбэка', () => {
  it('не зависит от регистра ключей', () => {
    const expected = { token: 'abc', orderId: 'o1', orderStatus: 7, paymentId: '42' };
    expect(parseCallback({ Token: 'abc', OrderId: 'o1', OrderStatus: 7, PaymentId: 42 })).toEqual(
      expected,
    );
    expect(
      parseCallback({ token: 'abc', orderId: 'o1', orderStatus: '7', paymentId: '42' }),
    ).toEqual(expected);
  });

  it('отклоняет колбэк без токена, заказа или статуса', () => {
    expect(parseCallback({ OrderId: 'o1', OrderStatus: 7 })).toBeNull();
    expect(parseCallback({ Token: 'abc', OrderStatus: 7 })).toBeNull();
    expect(parseCallback({ Token: 'abc', OrderId: 'o1', OrderStatus: 'paid' })).toBeNull();
    expect(parseCallback('{}')).toBeNull();
  });
});

describe('статусы поставщика', () => {
  it('зачисляет только Paid и Approve', () => {
    expect(mapOrderStatus(7)).toBe('paid');
    expect(mapOrderStatus(8)).toBe('paid');
    for (const code of [0, 1, 2, 3, 4, 5, 9]) expect(mapOrderStatus(code)).not.toBe('paid');
  });

  it('недоплату выделяет в своё состояние', () => {
    // Paymento не сообщает полученную сумму, и по факту зачисляет админ:
    // заказ должен быть виден в списке операций, а не тонуть среди «ожидает».
    expect(mapOrderStatus(2)).toBe('partial');
  });

  it('оставляет неизвестный код на разбор, а не угадывает', () => {
    expect(mapOrderStatus(0)).toBeNull();
    expect(mapOrderStatus(6)).toBeNull();
    expect(mapOrderStatus(42)).toBeNull();
  });
});

describe('адрес возврата', () => {
  it('поднимает http до https и не трогает остальное', () => {
    // Paymento отвечает на http «Only HTTPS URLs are allowed» — и это
    // выглядело бы как упавший шлюз, а не как ошибка адреса.
    expect(httpsOnly('http://localhost:3000/ru/x?order=1')).toEqual({
      url: 'https://localhost:3000/ru/x?order=1',
      upgraded: true,
    });
    expect(httpsOnly('https://noova.cc/ru/x')).toEqual({
      url: 'https://noova.cc/ru/x',
      upgraded: false,
    });
  });
});

describe('связь с Paymento', () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * Сбой сети — это сбой поставщика, а не наш: маршрут должен ответить 502
   * с понятным текстом, а не 500. Раньше ошибка `fetch` уходила наверх как есть.
   */
  it('недоступный шлюз даёт PaymentoError с причиной, а не сырую ошибку fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: new Error('getaddrinfo ENOTFOUND'),
        }),
      ),
    );
    const error = await createPayment({ eurCents: 1000, orderId: 'o1', returnUrl: 'https://x/' })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentoError);
    expect((error as PaymentoError).message).toContain('ENOTFOUND');
  });

  it('тайм-аут называется тайм-аутом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'TimeoutError')),
    );
    const error = await createPayment({ eurCents: 1000, orderId: 'o1', returnUrl: 'https://x/' })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentoError);
    expect((error as PaymentoError).message).toContain('не ответил за 10 с');
  });

  it('ответ без success — PaymentoError с сообщением поставщика', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, message: 'Invalid api key' }), {
          status: 401,
        }),
      ),
    );
    const error = await createPayment({ eurCents: 1000, orderId: 'o1', returnUrl: 'https://x/' })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentoError);
    expect((error as PaymentoError).message).toBe('Invalid api key');
  });
});
