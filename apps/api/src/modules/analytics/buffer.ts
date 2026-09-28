import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ProfileEventKind } from '../../generated/prisma/enums.js';

/** Одна строка на запись в буфере — тот же набор полей, что и у
 *  `ProfileEvent.create` в `events.ts`, но уже полностью посчитанный:
 *  дедуп, разметка бота и поиск анкеты сделаны до того, как строка сюда
 *  попала, буфер только откладывает саму вставку. */
export type BufferedEventRow = {
  profileId: string | null;
  kind: ProfileEventKind;
  userId: string | null;
  ipHash: string;
  sessionId: string | null;
  city: string | null;
  category: string | null;
  path: string | null;
  isBot: boolean;
  botReason: string | null;
};

/** Раз в секунду или раньше, если накопилось 500 строк (спека 1.3). Меньший
 *  порог продержал бы буфер открытым дольше пользы, больший — увеличил бы
 *  риск потерять накопленное при падении процесса между сбросами. */
const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER = 500;

/**
 * Буфер записи батчевых событий (`page_view`, `gallery_open`,
 * `search_filter`, фаза 1). Ответ `/api/e` не ждёт вставки в базу — событие
 * копится здесь и уходит одной многострочной вставкой по таймеру или по
 * заполнению. Единственное место, которое нужно поменять, если нагрузка на
 * запись когда-нибудь упрётся в Postgres (см. «Производительность» в спеке):
 * весь остальной код знает только про `push`.
 */
export class EventBuffer {
  private queue: BufferedEventRow[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  push(row: BufferedEventRow): void {
    this.queue.push(row);
    if (this.queue.length >= MAX_BUFFER) {
      void this.flush();
      return;
    }
    // Таймер только один на очередь: событие внутри уже открытого окна
    // просто ждёт его, а не двигает срок сброса дальше.
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Сколько строк сейчас ждут вставки. Только для тестов и диагностики. */
  get pending(): number {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    try {
      await this.prisma.profileEvent.createMany({ data: batch });
    } catch (error) {
      // Как и у остальных маяков: потерянные строки статистики — меньшее
      // зло, чем сложность повторной отправки. Не повторяем: `createMany`
      // это один INSERT, при сбое он не вставляет ничего из батча, и
      // повтор рисковал бы не задвоением, а бесконечным ростом очереди на
      // систематической (не разовой) ошибке записи.
      this.log.warn({ err: error, count: batch.length }, 'не удалось записать буфер событий');
    }
  }
}
