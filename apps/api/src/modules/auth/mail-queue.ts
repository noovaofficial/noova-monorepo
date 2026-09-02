import type { FastifyInstance } from 'fastify';
import type { Mail, Mailer } from './mailer.js';

export const MAIL_QUEUE_KEY = 'mail:queue';

type RedisLike = { lpush(key: string, value: string): Promise<unknown> };

/**
 * Положить письмо в очередь напрямую — для процессов без Fastify (фоновые
 * задачи). Формат тот же, что у `MailQueue.enqueue`: заберёт и отправит
 * цикл внутри API.
 */
export function pushMail(redis: RedisLike, mail: Mail): Promise<unknown> {
  return redis.lpush(MAIL_QUEUE_KEY, JSON.stringify({ ...mail, attempt: 0 }));
}
const MAX_ATTEMPTS = 5;

type QueuedMail = Mail & { attempt: number };

/**
 * Очередь писем в Redis.
 *
 * Отправлять внутри HTTP-запроса нельзя: недоступность почтового сервера
 * превратилась бы в 500 на регистрации. Пользователь не виноват, что у нас
 * не отвечает SMTP, и учётка должна создаться в любом случае.
 *
 * Список, а не полноценный брокер: писем немного, порядок не важен, а
 * `BRPOP` атомарен — при нескольких репликах API письмо заберёт ровно одна.
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
    const attempt = mail.attempt + 1;

    if (attempt >= MAX_ATTEMPTS) {
      // Дальше пытаться бессмысленно. Письмо теряется, и это видно в логах:
      // адрес есть, тела нет.
      this.fastify.log.error(
        { err: error, to: mail.to, attempts: attempt },
        'письмо не отправлено, попытки исчерпаны',
      );
      return;
    }

    // Экспоненциальная пауза: почтовый сервер мог просто перезапускаться,
    // и долбить его раз в секунду только хуже.
    const delayMs = Math.min(2 ** attempt * 1000, 60_000);
    // Причину пишем обязательно: без неё видно только «не отправилось»,
    // и разбираться приходится вслепую.
    this.fastify.log.warn({ err: error, to: mail.to, attempt, delayMs }, 'повтор отправки письма');

    setTimeout(() => {
      void redis.lpush(MAIL_QUEUE_KEY, JSON.stringify({ ...mail, attempt })).catch(() => undefined);
    }, delayMs).unref();
  }
}
