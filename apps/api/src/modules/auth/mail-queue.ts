import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Mail, Mailer } from './mailer.js';

export const MAIL_QUEUE_KEY = 'mail:queue';
/** Письма, ждущие повтора: сортированное множество, оценка — время повтора. */
export const MAIL_DELAYED_KEY = 'mail:delayed';

/** Сколько пытаться доставить письмо, прежде чем сдаться. */
export const MAIL_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** Через сколько неудач подряд письмо считается застрявшим — это тревога. */
export const MAIL_STUCK_MS = 10 * 60 * 1000;
const FIRST_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60 * 1000;

/**
 * Сообщения лога, по которым тревожится `infra/backup/app-alerts.sh`. Менять
 * только вместе с ним.
 */
export const MAIL_LOG = {
  stuck: 'письмо не уходит дольше 10 минут',
  dropped: 'письмо не отправлено, попытки исчерпаны',
  rejected: 'письмо отклонено почтовым сервером',
} as const;

type RedisLike = { lpush(key: string, value: string): Promise<unknown> };

export type QueuedMail = Mail & {
  /** Отличает два одинаковых письма в множестве отложенных. */
  id?: string;
  attempt: number;
  /** Время первой попытки. У писем, поставленных до этой правки, нет. */
  firstAt?: number;
  /** Тревога «застряло» по этому письму уже записана. */
  stuck?: boolean;
};

function queued(mail: Mail): string {
  const item: QueuedMail = { ...mail, id: randomUUID(), attempt: 0 };
  return JSON.stringify(item);
}

/**
 * Положить письмо в очередь напрямую — для процессов без Fastify (фоновые
 * задачи). Формат тот же, что у `MailQueue.enqueue`: заберёт и отправит
 * цикл внутри API.
 */
export function pushMail(redis: RedisLike, mail: Mail): Promise<unknown> {
  return redis.lpush(MAIL_QUEUE_KEY, queued(mail));
}

/**
 * Отказ, который повтор не исправит: почтовый сервер ответил 5xx — адреса
 * нет, письмо отвергнуто. Кроме отказа во входе (EAUTH): это наша настройка,
 * её починят, и письма должны уйти сами.
 */
export function isPermanentFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { responseCode, code } = error as { responseCode?: unknown; code?: unknown };
  return (
    typeof responseCode === 'number' &&
    responseCode >= 500 &&
    responseCode < 600 &&
    code !== 'EAUTH'
  );
}

export type RetryPlan =
  | { action: 'retry'; delayMs: number; mail: QueuedMail; justStuck: boolean }
  | { action: 'drop'; reason: 'permanent' | 'expired'; mail: QueuedMail };

/**
 * Что делать с письмом после неудачи. Временные сбои — сеть, DNS, перезапуск
 * почтового сервера, ответ 4xx — повторяются сутки: 27 ноября 2026 сбой DNS
 * длился девять дней, а прежние пять попыток за 40 секунд теряли письма,
 * которые через час ушли бы сами.
 */
export function planRetry(mail: QueuedMail, error: unknown, now: number): RetryPlan {
  const firstAt = mail.firstAt ?? now;
  const attempt = mail.attempt + 1;
  const next: QueuedMail = { ...mail, attempt, firstAt };

  if (isPermanentFailure(error)) return { action: 'drop', reason: 'permanent', mail: next };
  if (now - firstAt >= MAIL_GIVE_UP_MS) return { action: 'drop', reason: 'expired', mail: next };

  // 30 с, 1, 2, 4, 8 мин, дальше раз в 15 минут.
  const delayMs = Math.min(FIRST_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  const justStuck = !mail.stuck && now - firstAt >= MAIL_STUCK_MS;
  return { action: 'retry', delayMs, mail: { ...next, stuck: mail.stuck || justStuck }, justStuck };
}

/**
 * Переносит наступившие повторы в очередь. Одним скриптом: при нескольких
 * репликах API письмо заберёт ровно одна, и между «убрать» и «положить» оно
 * не потеряется.
 */
export const PROMOTE_DUE = `
local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
for _, item in ipairs(items) do
  redis.call('ZREM', KEYS[1], item)
  redis.call('LPUSH', KEYS[2], item)
end
return #items`;

/**
 * Очередь писем в Redis.
 *
 * Отправлять внутри HTTP-запроса нельзя: недоступность почтового сервера
 * превратилась бы в 500 на регистрации. Пользователь не виноват, что у нас
 * не отвечает SMTP, и учётка должна создаться в любом случае.
 *
 * Список, а не полноценный брокер: писем немного, порядок не важен, а
 * `BRPOP` атомарен — при нескольких репликах API письмо заберёт ровно одна.
 * Повторы ждут в сортированном множестве, а не в таймере процесса: ждать
 * приходится до суток, и перезапуск api (любой выкат) не должен их терять.
 */
export class MailQueue {
  private stopped = false;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly mailer: Mailer,
  ) {}

  /** Кладёт письмо в очередь. Не ждёт отправки и не бросает наружу. */
  enqueue(mail: Mail): void {
    void pushMail(this.fastify.redis, mail).catch((error) => {
      // Redis лежит — письмо потеряно, но регистрация всё равно проходит.
      // Логируем без тела: в нём одноразовая ссылка.
      this.fastify.log.error({ err: error, to: mail.to }, 'не удалось поставить письмо в очередь');
    });
  }

  /**
   * Фоновый цикл. Отдельное подключение к Redis: `BRPOP` блокирует клиент,
   * и на общем соединении встали бы все остальные команды, включая сессии.
   */
  start(): void {
    const redis = this.fastify.redis.duplicate();

    const loop = async () => {
      while (!this.stopped) {
        try {
          // Раз в цикл, то есть не реже чем раз в 5 секунд (тайм-аут BRPOP).
          await redis.eval(PROMOTE_DUE, 2, MAIL_DELAYED_KEY, MAIL_QUEUE_KEY, Date.now());

          const item = await redis.brpop(MAIL_QUEUE_KEY, 5);
          if (!item?.[1]) continue;

          const mail = JSON.parse(item[1]) as QueuedMail;
          try {
            await this.mailer.send(mail);
          } catch (error) {
            await this.retry(redis, mail, error);
          }
        } catch (error) {
          if (this.stopped) break;
          this.fastify.log.error({ err: error }, 'сбой цикла отправки писем');
          // Пауза, чтобы при недоступном Redis не крутить цикл вхолостую.
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      redis.disconnect();
    };

    void loop();
    this.fastify.addHook('onClose', async () => {
      this.stopped = true;
    });
  }

  private async retry(
    redis: ReturnType<FastifyInstance['redis']['duplicate']>,
    mail: QueuedMail,
    error: unknown,
  ): Promise<void> {
    const plan = planRetry(mail, error, Date.now());
    const { to, attempt } = plan.mail;

    if (plan.action === 'drop') {
      // Письмо теряется, и это видно в логах: адрес есть, тела нет.
      this.fastify.log.error(
        { err: error, to, attempts: attempt },
        plan.reason === 'permanent' ? MAIL_LOG.rejected : MAIL_LOG.dropped,
      );
      return;
    }

    if (plan.justStuck) {
      // Один раз на письмо: по этой строке приходит тревога в Telegram.
      this.fastify.log.error({ err: error, to, attempt }, MAIL_LOG.stuck);
    } else {
      // Причину пишем обязательно: без неё видно только «не отправилось»,
      // и разбираться приходится вслепую.
      this.fastify.log.warn(
        { err: error, to, attempt, delayMs: plan.delayMs },
        'повтор отправки письма',
      );
    }

    await redis.zadd(MAIL_DELAYED_KEY, Date.now() + plan.delayMs, JSON.stringify(plan.mail));
  }
}
