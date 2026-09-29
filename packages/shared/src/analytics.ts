import { z } from 'zod';
import { contactTypeSchema } from './contact';

/**
 * Статистика анкеты для того, кто её размещает.
 *
 * Четыре события — одна воронка: увидел страницу, отметил в избранном,
 * запросил контакты, позвонил. Смысл раздела именно в переходах между
 * ступенями: тысяча просмотров при трёх раскрытиях — это плохие фотографии
 * или цена, а тысяча раскрытий при трёх звонках — неработающий номер.
 * Поэтому метрики отдаются вместе и в одном порядке, а не набором
 * независимых счётчиков.
 *
 * Деление на вошедших и гостей есть у всех событий, кроме избранного:
 * отметить анкету может только вошедший клиент, и «гостевых» добавлений
 * не бывает по устройству функции.
 */

export const analyticsMetricSchema = z.enum([
  'views',
  'uniqueViewers',
  'favorites',
  'contactReveals',
  'contactClicks',
]);
export type AnalyticsMetric = z.infer<typeof analyticsMetricSchema>;

/**
 * Порядок в интерфейсе — порядок воронки, от широкой ступени к узкой.
 * `uniqueViewers` — не отдельная ступень, а уточнение «просмотров» (сколько
 * разных людей их дали), поэтому стоит сразу за ней, а не наравне с
 * избранным и контактами. См. `docs/analytics-metrics.md`.
 */
export const ANALYTICS_METRICS: readonly AnalyticsMetric[] = [
  'views',
  'uniqueViewers',
  'favorites',
  'contactReveals',
  'contactClicks',
] as const;

/**
 * Разбивка одного события. `total` не выводится сложением на клиенте:
 * события за границей периода отбрасываются сервером, и повторить его
 * арифметику фронту нечем.
 */
export const analyticsSplitSchema = z.object({
  total: z.number().int().min(0),
  /** Действовал вошедший пользователь. */
  registered: z.number().int().min(0),
  /** Вход не требуется ни для просмотра, ни для раскрытия контактов. */
  anonymous: z.number().int().min(0),
});
export type AnalyticsSplit = z.infer<typeof analyticsSplitSchema>;

/** Один день графика. Дни идут подряд, включая пустые: разрыв в ряду
 *  читался бы как «данных нет», а не как «в этот день не заходили». */
export const analyticsPointSchema = z.object({
  /** Дата в часовом поясе Европы/Берлина, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  views: z.number().int().min(0),
  /** Разных посетителей за этот день — не сумма за период, см.
   *  `docs/analytics-metrics.md#unique-viewer-уникальный-посетитель`. */
  uniqueViewers: z.number().int().min(0),
  favorites: z.number().int().min(0),
  contactReveals: z.number().int().min(0),
  contactClicks: z.number().int().min(0),
});
export type AnalyticsPoint = z.infer<typeof analyticsPointSchema>;

/** Клики по каналам связи: по какому именно с владелицей связываются. */
export const analyticsContactBreakdownSchema = z.object({
  type: contactTypeSchema,
  clicks: z.number().int().min(0),
});
export type AnalyticsContactBreakdown = z.infer<typeof analyticsContactBreakdownSchema>;

export const analyticsTotalsSchema = z.object({
  views: analyticsSplitSchema,
  /** Разбивки на вошедших/гостей у этой метрики по существу нет — один
   *  посетитель за день не гость и не вошедший, а просто один человек.
   *  `registered` здесь всегда 0, `anonymous` равен `total`: поле сохранено
   *  ради общей формы `AnalyticsSplit`, интерфейс эту разбивку не показывает
   *  (см. `MetricCard` в кабинете). */
  uniqueViewers: analyticsSplitSchema,
  /** Добавления в избранное. Гостевых не бывает — отметка требует входа. */
  favorites: analyticsSplitSchema,
  contactReveals: analyticsSplitSchema,
  contactClicks: analyticsSplitSchema,
});
export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>;

/** Строка разбивки по анкетам. Нужна агентству: у него их до восьми,
 *  и общая сумма не отвечает на вопрос «какая из них не работает». */
export const analyticsProfileRowSchema = z.object({
  profileId: z.string(),
  displayName: z.string(),
  slug: z.string(),
  views: z.number().int().min(0),
  uniqueViewers: z.number().int().min(0),
  favorites: z.number().int().min(0),
  contactReveals: z.number().int().min(0),
  contactClicks: z.number().int().min(0),
  /**
   * Ни одного контакта (раскрытия или клика) за последние 30 дней — фикс,
   * а не выбранный период отчёта: анкета за пределами окна «слота не
   * работает» одна на все выбранные периоды, иначе строка мигала бы
   * тревогой и обратно при переключении 7/30/90 дней.
   */
  hasNoContacts30d: z.boolean(),
});
export type AnalyticsProfileRow = z.infer<typeof analyticsProfileRowSchema>;

/**
 * Эффект ТОПа для одной анкеты: контакты в день во время последнего
 * размещения против 14 дней до его начала. Строится по `TopPlacement`,
 * который держит только текущее или последнее размещение анкеты (D-11:
 * покупка заново оживляет ту же строку), поэтому история более ранних
 * размещений сюда не попадает — прошлых покупок в базе просто не осталось.
 */
export const analyticsPromotionEffectSchema = z.object({
  profileId: z.string(),
  displayName: z.string(),
  slug: z.string(),
  /** ISO-дата начала и окончания размещения. */
  startsAt: z.string(),
  expiresAt: z.string(),
  /** Контакты в день за 14 суток до `startsAt`. */
  contactsPerDayBefore: z.number().min(0),
  /** Контакты в день за время действия ТОПа: от `startsAt` до `min(expiresAt, сейчас)`. */
  contactsPerDayDuring: z.number().min(0),
});
export type AnalyticsPromotionEffect = z.infer<typeof analyticsPromotionEffectSchema>;

/** Периоды выбраны так, чтобы младший укладывался в неделю рекламы,
 *  а старший не упирался в срок хранения журнала (365 дней). */
export const analyticsPeriodSchema = z.enum(['d7', 'd30', 'd90']);
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>;
export const ANALYTICS_PERIODS: readonly AnalyticsPeriod[] = ['d7', 'd30', 'd90'] as const;
export const ANALYTICS_PERIOD_DAYS: Record<AnalyticsPeriod, number> = { d7: 7, d30: 30, d90: 90 };

export const analyticsSchema = z.object({
  period: analyticsPeriodSchema,
  /** Начало периода — первый день ряда, ISO-дата в Европе/Берлине. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totals: analyticsTotalsSchema,
  series: z.array(analyticsPointSchema),
  contacts: z.array(analyticsContactBreakdownSchema),
  /** Пусто у индивидуалки и салона: анкета у них одна, и таблица из
   *  единственной строки повторяла бы карточки выше. */
  profiles: z.array(analyticsProfileRowSchema),
  /** Пусто у тех, кто ни разу не поднимал анкету в ТОП. */
  promotions: z.array(analyticsPromotionEffectSchema),
});
export type Analytics = z.infer<typeof analyticsSchema>;

/**
 * Что фронт сообщает серверу о событии. Просмотр и клик приходят маяком
 * из браузера: страница анкеты кэшируется (ISR), и серверный рендер
 * происходит далеко не на каждый заход — считать по нему было бы
 * не «сколько раз открыли», а «сколько раз протух кэш».
 */
export const trackClickSchema = z.object({ type: contactTypeSchema });
export type TrackClick = z.infer<typeof trackClickSchema>;
