import { z } from 'zod';

/**
 * Внутренний дашборд (фаза 6): источники трафика, спрос по городам и
 * выручка. Читает только роллапы (`SourceDailyStat`, `CityDailyStat`,
 * агрегаты `BillingTransaction` по дню) — сырые события дашборд не
 * сканирует, отсюда и требование «меньше секунды на 90 днях».
 */

/**
 * Свой набор периодов, не `AnalyticsPeriod` кабинета: здесь есть «1 день» —
 * пункт, которого нет и не нужен в отчёте рекламодателя по анкете. Общий
 * тип на двоих значил бы, что кнопка «1 день» рано или поздно всплывёт и
 * там, где её никто не просил.
 */
export const dashboardPeriodSchema = z.enum(['d1', 'd7', 'd30', 'd90']);
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
export const DASHBOARD_PERIODS: readonly DashboardPeriod[] = ['d1', 'd7', 'd30', 'd90'] as const;
export const DASHBOARD_PERIOD_DAYS: Record<DashboardPeriod, number> = {
  d1: 1,
  d7: 7,
  d30: 30,
  d90: 90,
};

export const dashboardSourceRowSchema = z.object({
  /** Классифицированный источник (`SourceKind`). */
  source: z.string(),
  /** Пустая строка — трафик без сети/кампании, не «нет данных». */
  network: z.string(),
  utmCampaign: z.string(),
  /** Все сессии разреза, включая ботов — знаменатель для `botSessions`. */
  sessions: z.number().int().min(0),
  botSessions: z.number().int().min(0),
  /** Не-бот контакты (`contact_reveal` + `contact_click`). */
  contacts: z.number().int().min(0),
  /**
   * Стоимость контакта. `null` до фазы 7: таблицы расходов на рекламу
   * (`ad_spend`) ещё нет, столбец уже здесь, чтобы фронт не переделывать
   * заново, когда она появится.
   */
  costPerContactEurCents: z.number().nullable(),
});
export type DashboardSourceRow = z.infer<typeof dashboardSourceRowSchema>;

export const dashboardSourcesSchema = z.object({
  rows: z.array(dashboardSourceRowSchema),
  totals: z.object({
    sessions: z.number().int().min(0),
    botSessions: z.number().int().min(0),
    contacts: z.number().int().min(0),
  }),
});
export type DashboardSources = z.infer<typeof dashboardSourcesSchema>;

export const dashboardCityRowSchema = z.object({
  city: z.string(),
  category: z.string(),
  sessions: z.number().int().min(0),
  profileViews: z.number().int().min(0),
  contacts: z.number().int().min(0),
  activeProfiles: z.number().int().min(0),
  /** `contacts / activeProfiles`; `null` — анкет нет, делить не на что. */
  contactsPerProfile: z.number().nullable(),
  /**
   * Спрос заметно опережает предложение — см. `flagHighDemand` в
   * `apps/api/.../dashboard.ts` за точным правилом. Эвристика, не факт:
   * порог можно и нужно будет поправить по реальным данным.
   */
  highDemand: z.boolean(),
});
export type DashboardCityRow = z.infer<typeof dashboardCityRowSchema>;

export const dashboardCitiesSchema = z.object({
  rows: z.array(dashboardCityRowSchema),
});
export type DashboardCities = z.infer<typeof dashboardCitiesSchema>;

export const dashboardRevenuePointSchema = z.object({
  /** Дата в часовом поясе Европы/Берлина, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  topupEurCents: z.number().int().min(0),
  spentListingGc: z.number().int().min(0),
  spentTopGc: z.number().int().min(0),
});
export type DashboardRevenuePoint = z.infer<typeof dashboardRevenuePointSchema>;

export const dashboardRevenueSchema = z.object({
  series: z.array(dashboardRevenuePointSchema),
  totals: z.object({
    topupEurCents: z.number().int().min(0),
    spentListingGc: z.number().int().min(0),
    spentTopGc: z.number().int().min(0),
  }),
});
export type DashboardRevenue = z.infer<typeof dashboardRevenueSchema>;

export const dashboardQuerySchema = z.object({
  period: dashboardPeriodSchema.default('d30'),
  /**
   * Конкретная дата (YYYY-MM-DD, Берлин) — если задана, отчёт строится
   * только за этот один день, `period` игнорируется сервером. Отдельное
   * поле, а не пятый пункт в `period`, потому что дата — любая, выбранная
   * руками, а не фиксированный пресет.
   */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

// --- Проверка качества трафика -----------------------------------------

export const trafficQualityQuerySchema = z.object({
  /** Единственный день (YYYY-MM-DD, Берлин), не диапазон — проверка на
   *  подозрительный трафик читается по одному дню, не по сумме многих. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Пусто — весь трафик дня; задано — только сессии этой кампании. */
  utmCampaign: z.string().max(200).optional(),
});
export type TrafficQualityQuery = z.infer<typeof trafficQualityQuerySchema>;

export const trafficQualityTopVisitorSchema = z.object({
  visitorHash: z.string(),
  deviceType: z.string().nullable(),
  sessions: z.number().int().min(0),
});
export type TrafficQualityTopVisitor = z.infer<typeof trafficQualityTopVisitorSchema>;

export const trafficQualityArrivalSchema = z.object({
  /** `HH:MM` начала десятиминутки, Берлин. */
  bucket: z.string(),
  sessions: z.number().int().min(0),
});
export type TrafficQualityArrival = z.infer<typeof trafficQualityArrivalSchema>;

/**
 * Пять диагностических срезов за один день: разнообразие посетителей,
 * самые активные устройства, доля сессий без единого события, воронка
 * просмотров/контактов и распределение по времени. Сознательно без
 * готового вердикта «бот/не бот» — у подозрительного и у просто тихого
 * дня цифры местами совпадают, и окончательное решение остаётся за тем,
 * кто смотрит на таблицы, а не за автоматикой.
 */
export const trafficQualitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** `null`, если проверялся весь день, без фильтра по кампании. */
  utmCampaign: z.string().nullable(),
  sessions: z.number().int().min(0),
  distinctVisitors: z.number().int().min(0),
  /** `null` — сессий нет, делить не на что. */
  sessionsPerVisitor: z.number().nullable(),
  topVisitors: z.array(trafficQualityTopVisitorSchema),
  sessionsWithoutEvents: z.number().int().min(0),
  sessionsWithoutEventsPct: z.number().nullable(),
  funnelSessionsWithActivity: z.number().int().min(0),
  funnelViews: z.number().int().min(0),
  funnelContacts: z.number().int().min(0),
  arrivals: z.array(trafficQualityArrivalSchema),
});
export type TrafficQuality = z.infer<typeof trafficQualitySchema>;

export const dashboardSchema = z.object({
  /** То, чем в итоге оказался отчёт: `d1`, если был задан `date` или выбран
   *  пресет «1 день» — различить их по этому полю нельзя и не нужно, оба
   *  дают окно в одни сутки. */
  period: dashboardPeriodSchema,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sources: dashboardSourcesSchema,
  cities: dashboardCitiesSchema,
  revenue: dashboardRevenueSchema,
});
export type Dashboard = z.infer<typeof dashboardSchema>;
