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
  ownProfile: (id: string) => ['own-profile', id] as const,
  cities: () => ['cities'] as const,
  serviceCatalog: (kind: string) => ['service-catalog', kind] as const,

  /** Модерация и админка. */
  queue: (kind?: string) => ['moderation-queue', kind ?? 'all'] as const,
  queueCount: () => ['moderation-queue-count'] as const,
  moderatedProfile: (id: string) => ['moderated-profile', id] as const,
  blockedProfiles: () => ['blocked-profiles'] as const,
  users: (query: string, blockedOnly = false) =>
    ['moderation-users', query, blockedOnly ? 'blocked' : 'all'] as const,
  staff: () => ['staff'] as const,
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
  favorites: () => ['favorites'] as const,
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
