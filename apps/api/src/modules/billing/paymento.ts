import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Locale, TopupOrderStatus } from '@noova/shared';
import { pino } from 'pino';
import { env } from '../../env.js';
import { loggerOptions } from '../../logger.js';

const log = pino({ ...loggerOptions, name: 'paymento' });

/**
 * Paymento — приём криптовалюты (payments.md, этап 4, D-08).
 *
 * Поток: создать платёж → отправить человека на шлюз → получить колбэк →
 * проверить подпись → подтвердить платёж их же API → зачислить. Зачисление
 * только по колбэку и только после verify: адрес возврата — навигация, а
 * не доказательство оплаты.
 */

export const PAYMENTO_PROVIDER = 'paymento';

/**
 * Speed = 1: ждём подтверждения блока, а не попадания в мемпул. Решение
 * владельца (2 сентября 2026): размещение отдаётся сразу и навсегда, и
 * откатить его при выпавшей из мемпула транзакции нечем.
 */
export const PAYMENTO_SPEED_CONFIRMED = 1;

/** Коды статуса заказа у Paymento, как в их документации. */
export const PaymentoStatus = {
  Initialize: 0,
  Pending: 1,
  PartialPaid: 2,
  WaitingToConfirm: 3,
  Timeout: 4,
  UserCanceled: 5,
  Paid: 7,
  Approve: 8,
  Reject: 9,
} as const;

export const isPaymentoConfigured = (): boolean =>
  env.PAYMENTO_API_KEY !== '' && env.PAYMENTO_SECRET_KEY !== '';

/**
 * Paymento принимает только HTTPS-адрес возврата и отвечает на http
 * «success: false» — для нас это выглядело бы как упавший шлюз. Схему
 * поднимаем, а не отклоняем заказ: локально без туннеля возврат на сайт всё
 * равно не сработает, но заказ и уход на шлюз — да, и это уже можно проверять.
 */
export function httpsOnly(url: string): { url: string; upgraded: boolean } {
  if (url.startsWith('http://'))
    return { url: `https://${url.slice('http://'.length)}`, upgraded: true };
  return { url, upgraded: false };
}

let warnedAboutScheme = false;

/** Адрес страницы заказа, куда касса вернёт человека после оплаты или отказа. */
export function returnUrlFor(locale: Locale, orderId: string): string {
  const base = env.PAYMENTO_RETURN_BASE_URL || env.PUBLIC_SITE_URL;
  const { url, upgraded } = httpsOnly(
    `${base}/${locale}/account/glowcoin/checkout?order=${orderId}`,
  );
  if (upgraded && !warnedAboutScheme) {
    warnedAboutScheme = true;
    log.warn(
      { base },
      'адрес возврата поднят до https: Paymento не принимает http. Для локальной проверки задайте PAYMENTO_RETURN_BASE_URL адресом туннеля',
    );
  }
  return url;
}

/** HMAC-SHA256 сырого тела, hex в верхнем регистре — так его шлёт Paymento. */
export function signatureFor(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex').toUpperCase();
}

/**
 * Сравнение постоянного времени: обычное `===` протекает по таймингу, а
 * подпись — единственное, что отделяет колбэк Paymento от чужого запроса.
 */
export function isValidSignature(
  rawBody: string | Buffer,
  header: string | string[] | undefined,
  secret: string,
): boolean {
  const given = Array.isArray(header) ? header[0] : header;
  if (!given || secret === '') return false;
  const expected = Buffer.from(signatureFor(rawBody, secret));
  const actual = Buffer.from(given.trim().toUpperCase());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type PaymentoCallback = {
  token: string;
  orderId: string;
  orderStatus: number;
  paymentId: string | null;
};

/**
 * Поля колбэка Paymento — в PascalCase, но их документация и примеры
 * расходятся в регистре. Ключи приводятся к нижнему регистру, чтобы
 * смена регистра на их стороне не превратилась в отклонённые платежи.
 */
export function parseCallback(raw: unknown): PaymentoCallback | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const lower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw)) lower.set(key.toLowerCase(), value);

  const token = lower.get('token');
  const orderId = lower.get('orderid');
  const status = Number(lower.get('orderstatus'));
  if (typeof token !== 'string' || token === '') return null;
  if (typeof orderId !== 'string' || orderId === '') return null;
  if (!Number.isInteger(status)) return null;

  const paymentId = lower.get('paymentid');
  return {
    token,
    orderId,
    orderStatus: status,
    paymentId: paymentId === undefined || paymentId === null ? null : String(paymentId),
  };
}

/**
 * Статус поставщика → состояние заказа. `null` — не менять: `Initialize`
 * ничего не сообщает, а неизвестный код лучше оставить на разбор, чем
 * угадать.
 */
export function mapOrderStatus(providerStatus: number): TopupOrderStatus | null {
  switch (providerStatus) {
    case PaymentoStatus.Paid:
    case PaymentoStatus.Approve:
      return 'paid';
    case PaymentoStatus.Pending:
    case PaymentoStatus.WaitingToConfirm:
      return 'pending';
    // Недоплата — отдельное состояние: заказ не ждёт сеть, а ждёт человека.
    case PaymentoStatus.PartialPaid:
      return 'partial';
    case PaymentoStatus.Timeout:
      return 'expired';
    case PaymentoStatus.UserCanceled:
      return 'canceled';
    case PaymentoStatus.Reject:
      return 'failed';
    default:
      return null;
  }
}

export class PaymentoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PaymentoError';
  }
}

type Envelope<T> = { success: boolean; message?: string; body: T };

async function call<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.PAYMENTO_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Api-key': env.PAYMENTO_API_KEY,
      'content-type': 'application/json',
      accept: 'text/plain',
    },
    body: JSON.stringify(body),
    // Шлюз, который не ответил за десять секунд, не ответит и за минуту;
    // человек в это время смотрит на крутилку.
    signal: AbortSignal.timeout(10_000),
  });

  const envelope = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !envelope || !envelope.success) {
    throw new PaymentoError(
      envelope?.message || `Paymento ответил ${response.status} на ${path}`,
      response.status,
    );
  }
  return envelope.body;
}

export async function createPayment(input: {
  eurCents: number;
  orderId: string;
  returnUrl: string;
}): Promise<{ token: string; paymentUrl: string }> {
  const token = await call<string>('/payment/request', {
    fiatAmount: (input.eurCents / 100).toFixed(2),
    fiatCurrency: 'EUR',
    ReturnUrl: input.returnUrl,
    orderId: input.orderId,
    Speed: PAYMENTO_SPEED_CONFIRMED,
  });
  if (typeof token !== 'string' || token === '') {
    throw new PaymentoError('Paymento не вернул токен платежа', 502);
  }
  return { token, paymentUrl: `${env.PAYMENTO_GATEWAY_URL}?token=${encodeURIComponent(token)}` };
}

/** Подтверждение у поставщика перед зачислением: колбэк — сигнал, verify — факт. */
export async function verifyPayment(token: string): Promise<{ orderId: string }> {
  const body = await call<{ orderId?: string; OrderId?: string }>('/payment/verify', { token });
  const orderId = body.orderId ?? body.OrderId;
  if (typeof orderId !== 'string' || orderId === '') {
    throw new PaymentoError('Paymento подтвердил платёж без orderId', 502);
  }
  return { orderId };
}
