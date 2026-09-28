import { z } from 'zod';
import { sessionIdSchema } from './attribution';
import { listingKindSchema } from './profile';

/**
 * Виды событий, которые едут батчем через `/api/e` (фаза 1), а не
 * отдельным маяком на каждое: их на порядок больше, чем открытий анкеты
 * (любой заход на город, категорию, поиск или главную), и вставка одной
 * строкой на событие не выдержала бы объём. Просмотр анкеты, клики по
 * контакту, раскрытие и избранное остаются на своих прежних маршрутах —
 * там запись синхронна с ответом не просто ради скорости, а потому что
 * раскрытие ещё и антифрод: сорвавшаяся запись обязана сорвать выдачу
 * контактов, а батч на такую гарантию не годится.
 */
export const BATCH_EVENT_NAMES = ['page_view', 'gallery_open', 'search_filter'] as const;
export type BatchEventName = (typeof BATCH_EVENT_NAMES)[number];

/** Путь без строки запроса и якоря — тот же формат, что и у `landingPath`
 *  сессии (`trackSessionSchema`). */
const pathSchema = z
  .string()
  .max(300)
  .regex(/^\/[^?#]*$/);

export const batchEventSchema = z.object({
  name: z.enum(BATCH_EVENT_NAMES),
  /**
   * Только у `gallery_open`: чья галерея. Слаг, а не внутренний id —
   * сервер сам находит анкету и берёт её настоящие город и категорию,
   * как и у остальных маяков; слаг несуществующей или неопубликованной
   * анкеты просто роняет событие, а не 404 на весь батч.
   */
  profileSlug: z.string().max(200).optional(),
  /**
   * У `page_view` и `search_filter`: контекст страницы, если он есть
   * (город каталога, категория раздела). В отличие от `city`/`category`
   * у событий анкеты, эти не сверяются со справочником — страница вроде
   * «вся страна» или главная имеет полное право прислать их пустыми, и
   * ошибка здесь стоит одной неточной строки в отчёте, не больше.
   */
  city: z.string().max(100).optional(),
  category: listingKindSchema.optional(),
  path: pathSchema,
  /** Время на клиенте — только для отладки задержки доставки; сервер
   *  своё `createdAt` всё равно ставит сам (спека 1.3), клиентскому не верит. */
  clientTs: z.number().int().min(0),
  sessionId: sessionIdSchema.optional(),
});
export type BatchEvent = z.infer<typeof batchEventSchema>;

/** Верхняя граница одного батча (спека 1.3): и на клиенте при разбиении
 *  очереди на запросы, и на сервере при проверке тела запроса. */
export const MAX_BATCH_EVENTS = 50;

export const eventBatchSchema = z.array(batchEventSchema).min(1).max(MAX_BATCH_EVENTS);
export type EventBatch = z.infer<typeof eventBatchSchema>;
