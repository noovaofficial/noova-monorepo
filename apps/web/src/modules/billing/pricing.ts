/**
 * Прайс-лист размещения и лестница пополнений — из `payments.md`.
 *
 * Пока это константы: экраны уже нужно верстать, а биллинга ещё нет.
 * По документу `PriceBook` и `TopupTier` обязаны быть конфигурируемыми
 * (курс, пороги и бонусы меняются без деплоя), поэтому при подключении API
 * этот файл заменяется загрузкой прайса с сервера, а не растаскивается
 * по компонентам.
 */

/** Витринный курс: 1 € = 10 GC. Реальная цена GlowCoin ниже — за счёт бонуса. */
export const GC_PER_EUR = 10;

export type PlanKind = 'individual' | 'salon' | 'agency';
export type PlanTerm = 'm1' | 'm6' | 'm12';

/** Цена размещения в GlowCoin по типу аккаунта и сроку (payments.md §3). */
export const PRICE_BOOK: Record<PlanKind, Record<PlanTerm, number>> = {
  individual: { m1: 170, m6: 690, m12: 990 },
  salon: { m1: 490, m6: 1990, m12: 2990 },
  agency: { m1: 990, m6: 3990, m12: 5990 },
};

/**
 * Сколько анкет входит в базу агентства. Сверх этого числа каждая анкета
 * оплачивается отдельно (payments.md §3.3).
 */
export const AGENCY_INCLUDED_SEATS = 5;

/** Доплата за анкету агентства сверх базы, по тому же сроку. */
export const SEAT_PRICE: Record<PlanTerm, number> = { m1: 150, m6: 600, m12: 890 };

/** Порядок сроков в интерфейсе — от короткого к длинному. */
export const PLAN_TERMS: PlanTerm[] = ['m1', 'm6', 'm12'];

/** Порядок типов размещения — по возрастанию цены. */
export const PLAN_KINDS: PlanKind[] = ['individual', 'salon', 'agency'];

/**
 * Минимальная цена — месячный срок. Её и показываем на публичной странице:
 * длинные сроки дешевле в пересчёте на месяц, но начинать разговор с
 * «990 GC» значит отпугнуть ценой, которую никто не обязан платить сразу.
 */
export const MIN_PLAN_GC: Record<PlanKind, number> = {
  individual: PRICE_BOOK.individual.m1,
  salon: PRICE_BOOK.salon.m1,
  agency: PRICE_BOOK.agency.m1,
};

/**
 * Пакеты пополнения (payments.md §2.1). Фиксированные суммы, а не произвольный
 * ввод: так бонусный порог однозначен и для биллинга, и для человека — он
 * видит ровно то, что получит, без округлений вниз до ближайшего уровня.
 */
export const TOPUP_PACKS = [
  { eur: 10, gc: 100, bonus: 0 },
  { eur: 25, gc: 275, bonus: 0.1 },
  { eur: 50, gc: 600, bonus: 0.2 },
  { eur: 100, gc: 1300, bonus: 0.3 },
  { eur: 200, gc: 2800, bonus: 0.4 },
  { eur: 300, gc: 4500, bonus: 0.5 },
] as const;

export type TopupPack = (typeof TOPUP_PACKS)[number];

/** €-эквивалент суммы в GlowCoin по витринному курсу. */
export function gcToEur(gc: number): number {
  return gc / GC_PER_EUR;
}

/**
 * Адрес оплаты пакета. Пока ведёт на внутреннюю заглушку — платёжного
 * провайдера ещё нет. Строится в одном месте, чтобы подключение кассы было
 * заменой одной функции, а не правкой каждой кнопки.
 */
export function checkoutUrl(eur: number): string {
  return `/account/glowcoin/checkout?pack=${eur}`;
}

export function findPack(eur: number): TopupPack | null {
  return TOPUP_PACKS.find((pack) => pack.eur === eur) ?? null;
}

/**
 * Начисление за пополнение (payments.md §2.1): `eur * курс * (1 + бонус)`.
 * Считаем, а не храним, — иначе таблица в админке позволила бы сохранить
 * лестницу, в которой начисление не сходится с курсом и бонусом.
 */
export function grantedGc(eur: number, bonus: number, rate: number = GC_PER_EUR): number {
  return Math.round(eur * rate * (1 + bonus));
}
