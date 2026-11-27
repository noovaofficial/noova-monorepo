import { describe, expect, it } from 'vitest';
import {
  isPermanentFailure,
  MAIL_GIVE_UP_MS,
  MAIL_STUCK_MS,
  planRetry,
  type QueuedMail,
} from './mail-queue.js';

const NOW = 1_800_000_000_000;
const mail = (over: Partial<QueuedMail> = {}): QueuedMail => ({
  to: 'a@example.com',
  subject: 's',
  text: 't',
  attempt: 0,
  ...over,
});
// Ответ Postfix при сбое DNS, 27 ноября 2026.
const dnsFailure = Object.assign(new Error('Recipient address rejected: Domain not found'), {
  code: 'EENVELOPE',
  responseCode: 450,
});

describe('isPermanentFailure', () => {
  it('5xx — постоянный отказ', () => {
    expect(isPermanentFailure({ code: 'EENVELOPE', responseCode: 550 })).toBe(true);
  });
  it('4xx, сеть и отказ во входе — временные', () => {
    expect(isPermanentFailure(dnsFailure)).toBe(false);
    expect(isPermanentFailure(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(isPermanentFailure({ code: 'EAUTH', responseCode: 535 })).toBe(false);
    expect(isPermanentFailure(null)).toBe(false);
  });
});

describe('planRetry', () => {
  it('первая неудача: повтор через 30 с, время первой попытки запоминается', () => {
    const plan = planRetry(mail(), dnsFailure, NOW);
    expect(plan).toMatchObject({ action: 'retry', delayMs: 30_000, justStuck: false });
    expect(plan.mail).toMatchObject({ attempt: 1, firstAt: NOW });
  });

  it('пауза растёт и упирается в 15 минут', () => {
    const delays = [1, 2, 3, 4, 5, 6, 10].map((attempt) => {
      const plan = planRetry(mail({ attempt, firstAt: NOW }), dnsFailure, NOW);
      return plan.action === 'retry' ? plan.delayMs : -1;
    });
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
  });

  it('застрявшее письмо отмечается один раз', () => {
    const later = NOW + MAIL_STUCK_MS;
    const first = planRetry(mail({ attempt: 4, firstAt: NOW }), dnsFailure, later);
    expect(first).toMatchObject({ action: 'retry', justStuck: true });
    const second = planRetry(first.mail, dnsFailure, later + 60_000);
    expect(second).toMatchObject({ action: 'retry', justStuck: false });
    expect(second.mail.stuck).toBe(true);
  });

  it('через сутки — сдаётся', () => {
    const plan = planRetry(mail({ attempt: 99, firstAt: NOW }), dnsFailure, NOW + MAIL_GIVE_UP_MS);
    expect(plan).toMatchObject({ action: 'drop', reason: 'expired' });
  });

  it('постоянный отказ не повторяется', () => {
    const plan = planRetry(mail(), { code: 'EENVELOPE', responseCode: 550 }, NOW);
    expect(plan).toMatchObject({ action: 'drop', reason: 'permanent' });
  });
});
