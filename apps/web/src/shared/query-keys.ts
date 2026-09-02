/**
 * Ключи запросов в одном месте, а не строками по компонентам.
 *
 * Собранный руками ключ рано или поздно разойдётся с тем, по которому лежит
 * кэш, — и `invalidateQueries` промахнётся. Список после мутации не обновится,
 * ошибка при этом не выпадет: экран просто покажет старые данные, и это
 * списывают на «подвисло». Единый модуль делает такой промах ошибкой типов.
 */
export const queryKeys = {
  /** Текущий пользователь. Один ключ на всё приложение. */
  session: () => ['session'] as const,

  /** Кабинет владельца. */
  ownProfiles: () => ['own-profiles'] as const,
  ownCompany: () => ['own-company'] as const,
  ownProfile: (id: string) => ['own-profile', id] as const,
  // Локаль — часть ключа: названия переведены на стороне API, и без неё
  // смена языка отдавала бы прежний список из кэша.
  cities: (locale: string) => ['cities', locale] as const,
  serviceCatalog: (kind: string, locale: string) => ['service-catalog', kind, locale] as const,

  /** Модерация и админка. */
  queue: (kind?: string) => ['moderation-queue', kind ?? 'all'] as const,
  queueCount: () => ['moderation-queue-count'] as const,
  moderatedProfile: (id: string) => ['moderated-profile', id] as const,
  blockedProfiles: () => ['blocked-profiles'] as const,
  users: (query: string, blockedOnly = false, role?: string) =>
    ['moderation-users', query, blockedOnly ? 'blocked' : 'all', role ?? 'any'] as const,
  staff: () => ['staff'] as const,
  adminCountries: () => ['admin-countries'] as const,
  adminCities: (countryId?: string) => ['admin-cities', countryId ?? 'all'] as const,
  adminServices: () => ['admin-services'] as const,
  billingConfig: () => ['billing-config'] as const,

  /** Монетизация в кабинете. */
  priceBook: () => ['price-book'] as const,
  wallet: () => ['wallet'] as const,
  listing: () => ['listing'] as const,
  topupOrder: (id: string) => ['topup-order', id] as const,
  billingOperations: (query: string) => ['billing-operations', query] as const,
  /** Все фильтры входят в ключ: иначе ответ на прежний запрос ляжет поверх нового. */
  moderationLog: (filters: Record<string, string | undefined> = {}) =>
    [
      'moderation-log',
      filters.moderatorId ?? 'all',
      filters.subjectType ?? 'all',
      filters.decision ?? 'all',
    ] as const,

  /** Разовое подтверждение адреса по ссылке из письма. */
  verifyEmail: (token: string) => ['verify-email', token] as const,

  /** Клиентские функции. */
  favoriteIds: () => ['favorite-ids'] as const,
  // Локаль в ключе: названия услуг приходят с сервера переведёнными, и после
  // смены языка кэш прошлого языка показывать нельзя.
  favorites: (locale?: string) =>
    (locale ? ['favorites', locale] : ['favorites']) as readonly unknown[],
  ownComment: (slug: string) => ['own-comment', slug] as const,
} as const;

/**
 * Префикс для инвалидации всей группы. `queryKeys.queue('photo')` и
 * `queryKeys.queue()` — разные ключи, но после решения модератора устареть
 * должны оба, иначе вкладка «Все» покажет уже обработанную карточку.
 */
export const queryPrefixes = {
  queue: () => ['moderation-queue'] as const,
} as const;
