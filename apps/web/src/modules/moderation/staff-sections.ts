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
export type StaffSectionGroup = 'moderation' | 'people' | 'reference' | 'mail';

export type StaffSection = {
  key:
    | 'moderation'
    | 'staff'
    | 'agencies'
    | 'individuals'
    | 'massageSalons'
    | 'allUsers'
    | 'log'
    | 'topNow'
    | 'locations'
    | 'serviceCatalog'
    | 'monetization'
    | 'agencyTariffs'
    | 'billingOps'
    | 'campaigns'
    | 'mailAdmin'
    | 'webmail';
  href: string;
  /** Состав персонала и состав стран — решения владельца, не оператора очереди. */
  adminOnly?: boolean;
  /** Подпись группы в сайдбаре персонала — ключ в словаре `auth`. */
  group: StaffSectionGroup;
  /** Не страница сайта, а другой сервис: открывается в новой вкладке. */
  external?: boolean;
};

// Почта живёт на отдельной машине (infra/relay, documentation/deploy/smtp.md),
// поэтому это внешние адреса, и вход там — учётка почтового сервера, а не сайта.
const MAIL_ADMIN_URL = 'https://mail.noova.fyi:8443/admin';
const WEBMAIL_URL = 'https://webmail.noova.fyi';

export const STAFF_SECTIONS: StaffSection[] = [
  // Порядок задан владельцем продукта: сначала ежедневная работа очереди,
  // затем разбор денег, затем настройка справочников и правил. Он же
  // порядок в шапке и в меню учётной записи — список один на оба места.
  { key: 'moderation', href: '/moderation', group: 'moderation' },
  { key: 'log', href: '/moderation/log', group: 'moderation' },
  { key: 'billingOps', href: '/admin/billing', adminOnly: true, group: 'moderation' },
  // Кто занимает места в ТОПе прямо сейчас — обзор для владельца продукта.
  { key: 'topNow', href: '/admin/top', adminOnly: true, group: 'moderation' },
  { key: 'staff', href: '/admin', adminOnly: true, group: 'people' },
  // Список агентств по типу рекламодателя — карточка агентства (тариф,
  // бан, ТОП, монеты) сама решает по роли, какие действия показать
  // (деньги — только админу), список открыт и модератору.
  { key: 'agencies', href: '/admin/companies', group: 'people' },
  { key: 'individuals', href: '/moderation/users/individuals', group: 'people' },
  { key: 'massageSalons', href: '/moderation/users/salons', group: 'people' },
  { key: 'allUsers', href: '/moderation/users', group: 'people' },
  { key: 'locations', href: '/admin/locations', adminOnly: true, group: 'reference' },
  { key: 'serviceCatalog', href: '/admin/services', adminOnly: true, group: 'reference' },
  // Цены и бонусы — деньги проекта, а не операционная работа очереди:
  // модератор их не видит и не меняет.
  { key: 'monetization', href: '/admin/monetization', adminOnly: true, group: 'reference' },
  // Сетка тарифов агентств по числу анкет (D-13) — то же решение владельца
  // продукта о деньгах, только своя страница: тарифов несколько, и правка
  // одной строкой в форме монетизации не поместилась бы.
  { key: 'agencyTariffs', href: '/admin/agency-tariffs', adminOnly: true, group: 'reference' },
  // Акции раздают размещения и монеты — то же решение владельца продукта,
  // что и цены, и той же ролью.
  { key: 'campaigns', href: '/admin/campaigns', adminOnly: true, group: 'reference' },
  // Ящики и их пароли — решение владельца, как и состав персонала.
  { key: 'mailAdmin', href: MAIL_ADMIN_URL, adminOnly: true, group: 'mail', external: true },
  // Почтовый клиент — рабочий инструмент и модератора: письма читают оба.
  { key: 'webmail', href: WEBMAIL_URL, group: 'mail', external: true },
];

export const isStaffRole = (role?: UserRole): boolean => role === 'moderator' || role === 'admin';

export const sectionsFor = (role?: UserRole): StaffSection[] =>
  isStaffRole(role)
    ? STAFF_SECTIONS.filter((section) => !section.adminOnly || role === 'admin')
    : [];
