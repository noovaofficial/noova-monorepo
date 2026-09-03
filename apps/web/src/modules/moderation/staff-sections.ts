import type { UserRole } from '@noova/shared';

/**
 * Разделы персонала: один список на шапку и на меню учётной записи.
 *
 * Раньше эти два места держали свои копии — с разными подписями («Очередь»
 * против «Модерация») и разным порядком. Копии разошлись ровно так, как
 * расходятся любые две копии; здесь источник один.
 *
 * `key` — ключ в словаре `auth`, он же используется меню: подписи обязаны
 * совпадать, иначе один и тот же раздел называется в шапке и в меню по-разному.
 */
export type StaffSection = {
  key:
    | 'moderation'
    | 'staff'
    | 'allUsers'
    | 'log'
    | 'locations'
    | 'serviceCatalog'
    | 'monetization'
    | 'billingOps'
    | 'campaigns';
  href: string;
  /** Состав персонала и состав стран — решения владельца, не оператора очереди. */
  adminOnly?: boolean;
};

export const STAFF_SECTIONS: StaffSection[] = [
  // Порядок задан владельцем продукта: сначала ежедневная работа очереди,
  // затем разбор денег, затем настройка справочников и правил. Он же
  // порядок в шапке и в меню учётной записи — список один на оба места.
  { key: 'moderation', href: '/moderation' },
  { key: 'log', href: '/moderation/log' },
  { key: 'billingOps', href: '/admin/billing', adminOnly: true },
  { key: 'staff', href: '/admin', adminOnly: true },
  { key: 'allUsers', href: '/moderation/users' },
  { key: 'locations', href: '/admin/locations', adminOnly: true },
  { key: 'serviceCatalog', href: '/admin/services', adminOnly: true },
  // Цены и бонусы — деньги проекта, а не операционная работа очереди:
  // модератор их не видит и не меняет.
  { key: 'monetization', href: '/admin/monetization', adminOnly: true },
  // Акции раздают размещения и монеты — то же решение владельца продукта,
  // что и цены, и той же ролью.
  { key: 'campaigns', href: '/admin/campaigns', adminOnly: true },
];

export const isStaffRole = (role?: UserRole): boolean => role === 'moderator' || role === 'admin';

export const sectionsFor = (role?: UserRole): StaffSection[] =>
  isStaffRole(role)
    ? STAFF_SECTIONS.filter((section) => !section.adminOnly || role === 'admin')
    : [];
