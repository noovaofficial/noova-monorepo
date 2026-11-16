/**
 * Условие «у анкеты есть видео, которое видит посетитель» — для `where`
 * каталога. Повторяет правило показа на странице анкеты (`publicVideoSelect`
 * и `ownerSubscribedSelect` в service.ts): обработано, одобрено, и у
 * владельца действует подписка.
 *
 * Отдельный файл без зависимостей: модуль запросов каталога не должен тянуть
 * за собой хранилище и биллинг. Список статусов подписки живёт здесь же;
 * биллинг берёт его отсюда (`VISIBLE_LISTING_STATUSES`).
 */
export const SUBSCRIBED_LISTING_STATUSES = ['active', 'grace'] as const;

export function publicVideoWhere() {
  return {
    videos: { some: { status: 'ready', isApproved: true } },
    owner: { listings: { some: { status: { in: [...SUBSCRIBED_LISTING_STATUSES] } } } },
  };
}
