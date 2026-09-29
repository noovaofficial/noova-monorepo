import { z } from 'zod';
import { analyticsPeriodSchema } from './analytics';

/**
 * Внутренний дашборд (фаза 6): источники трафика, спрос по городам и
 * выручка. Читает только роллапы (`SourceDailyStat`, `CityDailyStat`,
 * агрегаты `BillingTransaction` по дню) — сырые события дашборд не
 * сканирует, отсюда и требование «меньше секунды на 90 днях».
 */

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

export const dashboardQuerySchema = z.object({ period: analyticsPeriodSchema.default('d30') });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardSchema = z.object({
  period: analyticsPeriodSchema,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sources: dashboardSourcesSchema,
  cities: dashboardCitiesSchema,
  revenue: dashboardRevenueSchema,
});
export type Dashboard = z.infer<typeof dashboardSchema>;
