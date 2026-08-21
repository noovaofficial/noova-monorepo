/**
 * Справочник услуг. Единственный источник правды по составу каталога.
 * Ключи неизменяемы: они лежат в БД и в словарях фронта. Названия здесь
 * намеренно отсутствуют — они переводятся на три языка в `messages/*.json`
 * по ключу `services.<key>`.
 *
 * Порядок групп определяет порядок в интерфейсе: сопровождение, секс,
 * остальное. Параметры внешности и цены идут отдельными секциями до услуг.
 *
 * Состав каталога — продуктовое решение. Добавление услуги: строка сюда,
 * ключ в три словаря, `pnpm --filter @noova/api db:seed:services`.
 */
export type ServiceSeed = {
  key: string;
  group: string;
  appliesTo: ('escort' | 'massage')[];
};

/** Порядок групп в интерфейсе и в фильтрах. */
export const SERVICE_GROUPS = [
  'companionship',
  'sex',
  'massage',
  'striptease',
  'extreme',
  'bdsm',
  'format',
] as const;

export const SERVICE_CATALOG: ServiceSeed[] = [
  // Сопровождение
  { key: 'dinner_date', group: 'companionship', appliesTo: ['escort'] },
  { key: 'events', group: 'companionship', appliesTo: ['escort'] },
  { key: 'photoshoot', group: 'companionship', appliesTo: ['escort'] },
  { key: 'travel_companion', group: 'companionship', appliesTo: ['escort'] },
  { key: 'travel_abroad', group: 'companionship', appliesTo: ['escort'] },
  { key: 'overnight', group: 'companionship', appliesTo: ['escort'] },

  // Секс
  { key: 'sex_classic', group: 'sex', appliesTo: ['escort'] },
  { key: 'sex_anal', group: 'sex', appliesTo: ['escort'] },
  { key: 'sex_group', group: 'sex', appliesTo: ['escort'] },
  { key: 'sex_lesbian', group: 'sex', appliesTo: ['escort'] },
  { key: 'sex_couples', group: 'sex', appliesTo: ['escort'] },
  { key: 'bj_condom', group: 'sex', appliesTo: ['escort'] },
  { key: 'bj_no_condom', group: 'sex', appliesTo: ['escort'] },
  { key: 'bj_deep', group: 'sex', appliesTo: ['escort'] },
  { key: 'bj_throat', group: 'sex', appliesTo: ['escort'] },
  { key: 'bj_car', group: 'sex', appliesTo: ['escort'] },
  { key: 'cunnilingus', group: 'sex', appliesTo: ['escort'] },
  { key: 'kissing', group: 'sex', appliesTo: ['escort'] },
  { key: 'toys', group: 'sex', appliesTo: ['escort'] },
  { key: 'finish_breast', group: 'sex', appliesTo: ['escort'] },
  { key: 'finish_face', group: 'sex', appliesTo: ['escort'] },
  { key: 'finish_mouth', group: 'sex', appliesTo: ['escort'] },
  { key: 'position_69', group: 'sex', appliesTo: ['escort'] },

  // Массаж
  { key: 'massage_classic', group: 'massage', appliesTo: [] },
  { key: 'massage_professional', group: 'massage', appliesTo: [] },
  { key: 'massage_relaxing', group: 'massage', appliesTo: [] },
  { key: 'massage_urological', group: 'massage', appliesTo: [] },
  { key: 'massage_erotic', group: 'massage', appliesTo: [] },
  { key: 'massage_couples', group: 'massage', appliesTo: [] },
  { key: 'massage_table', group: 'massage', appliesTo: [] },

  // Стриптиз
  { key: 'striptease_pro', group: 'striptease', appliesTo: ['escort'] },
  { key: 'striptease_amateur', group: 'striptease', appliesTo: ['escort'] },
  { key: 'lesbi_show_light', group: 'striptease', appliesTo: ['escort'] },
  { key: 'lesbi_explicit', group: 'striptease', appliesTo: ['escort'] },

  // Экстрим
  { key: 'strapon', group: 'extreme', appliesTo: ['escort'] },
  { key: 'anilingus_to_client', group: 'extreme', appliesTo: ['escort'] },
  { key: 'anilingus_to_me', group: 'extreme', appliesTo: ['escort'] },
  { key: 'golden_to_client', group: 'extreme', appliesTo: ['escort'] },
  { key: 'golden_to_me', group: 'extreme', appliesTo: ['escort'] },
  { key: 'fisting_anal_client', group: 'extreme', appliesTo: ['escort'] },
  { key: 'fisting_anal_me', group: 'extreme', appliesTo: ['escort'] },
  { key: 'fisting_classic', group: 'extreme', appliesTo: ['escort'] },
  { key: 'fingering', group: 'extreme', appliesTo: ['escort'] },
  { key: 'double_penetration', group: 'extreme', appliesTo: ['escort'] },

  // Садо-мазо
  { key: 'ballbusting', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'mistress', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'domination', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'slave', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'submission', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'bondage', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'spanking', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'fetish', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'trampling', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'shibari', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'facesitting', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'copro_give', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'copro_take', group: 'bdsm', appliesTo: ['escort'] },
  { key: 'squirt', group: 'bdsm', appliesTo: ['escort'] },

  // Формат встречи
  { key: 'incall', group: 'format', appliesTo: [] },
  { key: 'outcall', group: 'format', appliesTo: [] },
  { key: 'hotel_visit', group: 'format', appliesTo: ['escort'] },
];
