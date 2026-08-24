/**
 * Названия справочников на трёх языках.
 *
 * Раньше жили в `apps/web/messages/*.json` под ключами `services.*` и
 * `serviceGroups.*`. Переехали сюда, потому что справочники редактируются
 * из админки (N-32, N-36): название, заведённое администратором, в словарь
 * фронта не попадёт и отрисовалось бы сырым ключом.
 *
 * Держать две копии нельзя — они разойдутся. После переезда ключи из
 * словарей фронта убраны, названия приходят из API.
 */
import type { Locale } from '@noova/shared';

export type Translated = Record<Locale, string>;

/** Названия услуг. Ключ совпадает с `Service.key`. */
export const SERVICE_NAMES: Record<string, Translated> = {
  dinner_date: { de: 'Dinner-Date', en: 'Dinner date', ru: 'Ужин' },
  events: { de: 'Veranstaltungen', en: 'Events', ru: 'Мероприятия' },
  photoshoot: { de: 'Fotoshootings', en: 'Photoshoots', ru: 'Фотосессии' },
  travel_companion: {
    de: 'Reisebegleitung',
    en: 'Travel companion',
    ru: 'Сопровождение в поездках',
  },
  travel_abroad: { de: 'Auslandsreisen', en: 'Trips abroad', ru: 'Поездки за границу' },
  overnight: { de: 'Über Nacht', en: 'Overnight', ru: 'Ночь' },
  sex_classic: { de: 'Klassischer Sex', en: 'Classic sex', ru: 'Секс классический' },
  sex_anal: { de: 'Analsex', en: 'Anal sex', ru: 'Секс анальный' },
  sex_group: { de: 'Gruppensex', en: 'Group sex', ru: 'Секс групповой' },
  sex_lesbian: { de: 'Lesbischer Sex', en: 'Lesbian sex', ru: 'Секс лесбийский' },
  sex_couples: { de: 'Für Paare', en: 'For couples', ru: 'Семейной паре' },
  bj_condom: { de: 'Oral mit Kondom', en: 'Oral with condom', ru: 'Минет в резинке' },
  bj_no_condom: { de: 'Oral ohne Kondom', en: 'Oral without condom', ru: 'Минет без резинки' },
  bj_deep: { de: 'Deep Throat', en: 'Deep throat', ru: 'Минет глубокий' },
  bj_throat: { de: 'Kehlenoral', en: 'Throat oral', ru: 'Минет горловой' },
  bj_car: { de: 'Oral im Auto', en: 'Oral in car', ru: 'Минет в машине' },
  cunnilingus: { de: 'Cunnilingus', en: 'Cunnilingus', ru: 'Куннилингус' },
  kissing: { de: 'Küssen', en: 'Kissing', ru: 'Целуюсь' },
  toys: { de: 'Spielzeug', en: 'Toys', ru: 'Игрушки' },
  finish_breast: {
    de: 'Abschluss auf die Brust',
    en: 'Finish on breasts',
    ru: 'Окончание на грудь',
  },
  finish_face: { de: 'Abschluss ins Gesicht', en: 'Finish on face', ru: 'Окончание на лицо' },
  finish_mouth: { de: 'Abschluss in den Mund', en: 'Finish in mouth', ru: 'Окончание в рот' },
  position_69: { de: '69er-Stellung', en: '69 position', ru: 'Поза 69' },
  massage_classic: { de: 'Klassische Massage', en: 'Classic massage', ru: 'Массаж классический' },
  massage_professional: {
    de: 'Professionelle Massage',
    en: 'Professional massage',
    ru: 'Массаж профессиональный',
  },
  massage_relaxing: {
    de: 'Entspannungsmassage',
    en: 'Relaxing massage',
    ru: 'Массаж расслабляющий',
  },
  massage_urological: {
    de: 'Urologische Massage',
    en: 'Urological massage',
    ru: 'Массаж урологический',
  },
  massage_erotic: { de: 'Erotische Massage', en: 'Erotic massage', ru: 'Массаж эротический' },
  massage_couples: {
    de: 'Massage für Paare',
    en: 'Massage for couples',
    ru: 'Массаж семейной паре',
  },
  massage_table: { de: 'Massagetisch', en: 'Massage table', ru: 'Массажный стол' },
  striptease_pro: { de: 'Profi-Striptease', en: 'Professional striptease', ru: 'Стриптиз профи' },
  striptease_amateur: {
    de: 'Amateur-Striptease',
    en: 'Amateur striptease',
    ru: 'Стриптиз не профи',
  },
  lesbi_show_light: { de: 'Leichte Lesbenshow', en: 'Light lesbian show', ru: 'Лесби-шоу лёгкое' },
  lesbi_explicit: {
    de: 'Explizite Lesbenshow',
    en: 'Explicit lesbian show',
    ru: 'Лесби откровенное',
  },
  strapon: { de: 'Umschnalldildo', en: 'Strap-on', ru: 'Страпон' },
  anilingus_to_client: {
    de: 'Anilingus für den Kunden',
    en: 'Anilingus to client',
    ru: 'Анилингус клиенту',
  },
  anilingus_to_me: { de: 'Anilingus für mich', en: 'Anilingus to me', ru: 'Анилингус мне' },
  golden_to_client: {
    de: 'Natursekt aktiv',
    en: 'Golden shower to client',
    ru: 'Золотой дождь клиенту',
  },
  golden_to_me: { de: 'Natursekt passiv', en: 'Golden shower to me', ru: 'Золотой дождь мне' },
  fisting_anal_client: {
    de: 'Anales Fisting aktiv',
    en: 'Anal fisting to client',
    ru: 'Фистинг анальный клиенту',
  },
  fisting_anal_me: {
    de: 'Anales Fisting passiv',
    en: 'Anal fisting to me',
    ru: 'Фистинг анальный мне',
  },
  fisting_classic: { de: 'Klassisches Fisting', en: 'Classic fisting', ru: 'Фистинг классический' },
  fingering: { de: 'Fingering', en: 'Fingering', ru: 'Фингеринг' },
  double_penetration: {
    de: 'Doppelpenetration',
    en: 'Double penetration',
    ru: 'Двойное проникновение',
  },
  ballbusting: { de: 'Ballbusting', en: 'Ballbusting', ru: 'Боллбастинг' },
  mistress: { de: 'Herrin', en: 'Mistress', ru: 'Госпожа' },
  domination: { de: 'Dominanz', en: 'Domination', ru: 'Доминирование' },
  slave: { de: 'Sklavin', en: 'Slave', ru: 'Рабыня' },
  submission: { de: 'Unterwerfung', en: 'Submission', ru: 'Подчинение' },
  bondage: { de: 'Bondage', en: 'Bondage', ru: 'Бондаж' },
  spanking: { de: 'Spanking', en: 'Spanking', ru: 'Порка' },
  fetish: { de: 'Fetisch', en: 'Fetish', ru: 'Фетиш' },
  trampling: { de: 'Trampling', en: 'Trampling', ru: 'Трамплинг' },
  shibari: { de: 'Shibari', en: 'Shibari', ru: 'Шибари' },
  facesitting: { de: 'Facesitting', en: 'Facesitting', ru: 'Фейсситтинг' },
  copro_give: { de: 'Kaviar aktiv', en: 'Copro (active)', ru: 'Копро (выдача)' },
  copro_take: { de: 'Kaviar passiv', en: 'Copro (passive)', ru: 'Копро (приём)' },
  squirt: { de: 'Squirt', en: 'Squirt', ru: 'Сквирт' },
  incall: { de: 'Bei mir', en: 'Incall', ru: 'У себя' },
  outcall: { de: 'Hausbesuch', en: 'Outcall', ru: 'Выезд' },
  hotel_visit: { de: 'Hotelbesuch', en: 'Hotel visit', ru: 'Визит в отель' },
};

/** Названия групп. Ключ совпадает с `Service.group`. */
export const SERVICE_GROUP_NAMES: Record<string, Translated> = {
  companionship: { de: 'Begleitung', en: 'Companionship', ru: 'Сопровождение' },
  sex: { de: 'Sex', en: 'Sex', ru: 'Секс' },
  massage: { de: 'Massage', en: 'Massage', ru: 'Массаж' },
  striptease: { de: 'Striptease', en: 'Striptease', ru: 'Стриптиз' },
  extreme: { de: 'Extrem', en: 'Extreme', ru: 'Экстрим' },
  bdsm: { de: 'BDSM', en: 'BDSM', ru: 'Садо-мазо' },
  format: { de: 'Format', en: 'Format', ru: 'Формат встречи' },
};
