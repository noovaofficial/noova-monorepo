/**
 * Справочники: страны, города, районы, услуги. **Файл генерируется.**
 *
 *   pnpm --filter @noova/api db:export:reference
 *
 * Править руками можно — это обычный TypeScript, — но следующая выгрузка
 * перепишет файл целиком по состоянию базы. Порядок работы обратный:
 * менять справочник в админке, потом выгружать и коммитить.
 *
 * Идентификаторы здесь не украшение: `db:seed:reference` проставляет их
 * при создании, и справочник, восстановленный на чистой машине, получает те
 * же id. Иначе всё, что на него ссылается, указывало бы в пустоту.
 *
 * Состав каталога услуг — продуктовое решение владельца, а не техническое.
 */
import type { ListingKind, Locale } from '@noova/shared';

export type Translated = Record<Locale, string>;

export type CountrySeed = {
  id: string;
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: Translated;
  isActive: boolean;
};

export type DistrictSeed = {
  id: string;
  slug: string;
  name: Translated;
  /** Центр района: из него собирается приблизительное место анкеты. */
  lat: number;
  lng: number;
  isActive: boolean;
};

export type CitySeed = {
  id: string;
  slug: string;
  name: Translated;
  countryCode: string;
  lat: number;
  lng: number;
  isActive: boolean;
  /** Необязательны: город может не делиться на районы. */
  districts: DistrictSeed[];
};

export type ServiceGroupSeed = { key: string; name: Translated };

export type ServiceSeed = {
  id: string;
  key: string;
  group: string;
  appliesTo: ListingKind[];
  position: number;
  isActive: boolean;
  name: Translated;
};


export const COUNTRIES: CountrySeed[] = [
  { id: "114ed69b-7ad1-41bc-a842-eec130f4f64c", code: "DE", name: { de: "Deutschland", en: "Germany", ru: "Германия" }, isActive: true },
];


export const CITIES: CitySeed[] = [
  {
    id: "cmt19tfre0001z7b0jevq7fcj",
    slug: "berlin",
    name: { de: "Berlin", en: "Berlin", ru: "Берлин" },
    countryCode: "DE",
    lat: 52.52,
    lng: 13.405,
    isActive: true,
    districts: [
      { id: "cmt19tfri0003z7b0lfl5sfue", slug: "charlottenburg", name: { de: "Charlottenburg", en: "Charlottenburg", ru: "Шарлоттенбург" }, lat: 52.505, lng: 13.304, isActive: true },
      { id: "cmt19tfri0006z7b0e8i5psjm", slug: "friedrichshain", name: { de: "Friedrichshain", en: "Friedrichshain", ru: "Фридрихсхайн" }, lat: 52.515, lng: 13.454, isActive: true },
      { id: "cmt19tfri0004z7b0agkspzcf", slug: "kreuzberg", name: { de: "Kreuzberg", en: "Kreuzberg", ru: "Кройцберг" }, lat: 52.498, lng: 13.403, isActive: true },
      { id: "cmt19tfrh0002z7b07wgjt8rj", slug: "mitte", name: { de: "Mitte", en: "Mitte", ru: "Митте" }, lat: 52.5244, lng: 13.4105, isActive: true },
      { id: "cmt19tfri0007z7b0fxg8dzm5", slug: "neukoelln", name: { de: "Neukölln", en: "Neukölln", ru: "Нойкёльн" }, lat: 52.481, lng: 13.435, isActive: true },
      { id: "cmt19tfri0005z7b0nu7dil7y", slug: "prenzlauer-berg", name: { de: "Prenzlauer Berg", en: "Prenzlauer Berg", ru: "Пренцлауэр-Берг" }, lat: 52.539, lng: 13.424, isActive: true },
      { id: "cmt19tfri0008z7b0fecolu1j", slug: "schoeneberg", name: { de: "Schöneberg", en: "Schöneberg", ru: "Шёнеберг" }, lat: 52.483, lng: 13.355, isActive: true },
      { id: "cmt19tfri0009z7b0ujqhrngt", slug: "tiergarten", name: { de: "Tiergarten", en: "Tiergarten", ru: "Тиргартен" }, lat: 52.514, lng: 13.35, isActive: true },
    ],
  },
];


/** Порядок групп задаёт вид панели фильтров. */
export const SERVICE_GROUPS: ServiceGroupSeed[] = [
  { key: "companionship", name: { de: "Begleitung", en: "Companionship", ru: "Сопровождение" } },
  { key: "sex", name: { de: "Sex", en: "Sex", ru: "Секс" } },
  { key: "massage", name: { de: "Massage", en: "Massage", ru: "Массаж" } },
  { key: "striptease", name: { de: "Striptease", en: "Striptease", ru: "Стриптиз" } },
  { key: "extreme", name: { de: "Extrem", en: "Extreme", ru: "Экстрим" } },
  { key: "bdsm", name: { de: "BDSM", en: "BDSM", ru: "Садо-мазо" } },
  { key: "format", name: { de: "Format", en: "Format", ru: "Формат встречи" } },
];


export const SERVICES: ServiceSeed[] = [
  { id: "cmt0dmnok000a4wb0uiyjlynd", key: "dinner_date", group: "companionship", appliesTo: ["escort"], position: 0, isActive: true, name: { de: "Dinner-Date", en: "Dinner date", ru: "Ужин" } },
  { id: "cmt0dmnok000c4wb07sytl5x4", key: "events", group: "companionship", appliesTo: ["escort"], position: 1, isActive: true, name: { de: "Veranstaltungen", en: "Events", ru: "Мероприятия" } },
  { id: "cmt19n3mh0003cmb0yaggq38d", key: "photoshoot", group: "companionship", appliesTo: ["escort"], position: 2, isActive: true, name: { de: "Fotoshootings", en: "Photoshoots", ru: "Фотосессии" } },
  { id: "cmt0dmnok000b4wb0ztahpysd", key: "travel_companion", group: "companionship", appliesTo: ["escort"], position: 3, isActive: true, name: { de: "Reisebegleitung", en: "Travel companion", ru: "Сопровождение в поездках" } },
  { id: "cmt1irvgm0004xab0o0fmi6xr", key: "travel_abroad", group: "companionship", appliesTo: ["escort"], position: 4, isActive: true, name: { de: "Auslandsreisen", en: "Trips abroad", ru: "Поездки за границу" } },
  { id: "cmt19n3mj0005cmb04wvgdi4z", key: "overnight", group: "companionship", appliesTo: ["escort"], position: 5, isActive: true, name: { de: "Über Nacht", en: "Overnight", ru: "Ночь" } },
  { id: "cmt1irvgo0006xab04vf0i1ut", key: "sex_classic", group: "sex", appliesTo: ["escort"], position: 106, isActive: true, name: { de: "Klassischer Sex", en: "Classic sex", ru: "Секс классический" } },
  { id: "cmt1irvgp0007xab041pbkxwg", key: "sex_anal", group: "sex", appliesTo: ["escort"], position: 107, isActive: true, name: { de: "Analsex", en: "Anal sex", ru: "Секс анальный" } },
  { id: "cmt1irvgq0008xab0q8up879s", key: "sex_group", group: "sex", appliesTo: ["escort"], position: 108, isActive: true, name: { de: "Gruppensex", en: "Group sex", ru: "Секс групповой" } },
  { id: "cmt1irvgr0009xab0d6tcn5km", key: "sex_lesbian", group: "sex", appliesTo: ["escort"], position: 109, isActive: true, name: { de: "Lesbischer Sex", en: "Lesbian sex", ru: "Секс лесбийский" } },
  { id: "cmt1irvgs000axab0kl2ym0m3", key: "sex_couples", group: "sex", appliesTo: ["escort"], position: 110, isActive: true, name: { de: "Für Paare", en: "For couples", ru: "Семейной паре" } },
  { id: "cmt1irvgt000bxab0mfivptc0", key: "bj_condom", group: "sex", appliesTo: ["escort"], position: 111, isActive: true, name: { de: "Oral mit Kondom", en: "Oral with condom", ru: "Минет в резинке" } },
  { id: "cmt1irvgt000cxab00tfyk2uj", key: "bj_no_condom", group: "sex", appliesTo: ["escort"], position: 112, isActive: true, name: { de: "Oral ohne Kondom", en: "Oral without condom", ru: "Минет без резинки" } },
  { id: "cmt1irvgu000dxab00qp3ihe8", key: "bj_deep", group: "sex", appliesTo: ["escort"], position: 113, isActive: true, name: { de: "Deep Throat", en: "Deep throat", ru: "Минет глубокий" } },
  { id: "cmt1irvgu000exab000if7dz4", key: "bj_throat", group: "sex", appliesTo: ["escort"], position: 114, isActive: true, name: { de: "Kehlenoral", en: "Throat oral", ru: "Минет горловой" } },
  { id: "cmt1irvgv000fxab0q4rbe780", key: "bj_car", group: "sex", appliesTo: ["escort"], position: 115, isActive: true, name: { de: "Oral im Auto", en: "Oral in car", ru: "Минет в машине" } },
  { id: "cmt1irvgw000gxab0l3b71121", key: "cunnilingus", group: "sex", appliesTo: ["escort"], position: 116, isActive: true, name: { de: "Cunnilingus", en: "Cunnilingus", ru: "Куннилингус" } },
  { id: "cmt1irvgw000hxab0svexmeap", key: "kissing", group: "sex", appliesTo: ["escort"], position: 117, isActive: true, name: { de: "Küssen", en: "Kissing", ru: "Целуюсь" } },
  { id: "cmt1irvgx000ixab0kv3n8whg", key: "toys", group: "sex", appliesTo: ["escort"], position: 118, isActive: true, name: { de: "Spielzeug", en: "Toys", ru: "Игрушки" } },
  { id: "cmt1irvgx000jxab0xrrpmsrs", key: "finish_breast", group: "sex", appliesTo: ["escort"], position: 119, isActive: true, name: { de: "Abschluss auf die Brust", en: "Finish on breasts", ru: "Окончание на грудь" } },
  { id: "cmt1irvgy000kxab07xeue4p7", key: "finish_face", group: "sex", appliesTo: ["escort"], position: 120, isActive: true, name: { de: "Abschluss ins Gesicht", en: "Finish on face", ru: "Окончание на лицо" } },
  { id: "cmt1irvgy000lxab0q2505jiv", key: "finish_mouth", group: "sex", appliesTo: ["escort"], position: 121, isActive: true, name: { de: "Abschluss in den Mund", en: "Finish in mouth", ru: "Окончание в рот" } },
  { id: "cmt1irvgz000mxab06cyji0pi", key: "position_69", group: "sex", appliesTo: ["escort"], position: 122, isActive: true, name: { de: "69er-Stellung", en: "69 position", ru: "Поза 69" } },
  { id: "cmt1irvh0000nxab045tb9sfn", key: "massage_classic", group: "massage", appliesTo: [], position: 223, isActive: true, name: { de: "Klassische Massage", en: "Classic massage", ru: "Массаж классический" } },
  { id: "cmt1irvh0000oxab07hxbb5xk", key: "massage_professional", group: "massage", appliesTo: [], position: 224, isActive: true, name: { de: "Professionelle Massage", en: "Professional massage", ru: "Массаж профессиональный" } },
  { id: "cmt1irvh1000pxab0nnhiyjjx", key: "massage_relaxing", group: "massage", appliesTo: [], position: 225, isActive: true, name: { de: "Entspannungsmassage", en: "Relaxing massage", ru: "Массаж расслабляющий" } },
  { id: "cmt1irvh1000qxab022byl5h4", key: "massage_urological", group: "massage", appliesTo: [], position: 226, isActive: true, name: { de: "Urologische Massage", en: "Urological massage", ru: "Массаж урологический" } },
  { id: "cmt1irvh2000rxab04owuuzmu", key: "massage_erotic", group: "massage", appliesTo: [], position: 227, isActive: true, name: { de: "Erotische Massage", en: "Erotic massage", ru: "Массаж эротический" } },
  { id: "cmt1irvh3000sxab08qw74bsb", key: "massage_couples", group: "massage", appliesTo: [], position: 228, isActive: true, name: { de: "Massage für Paare", en: "Massage for couples", ru: "Массаж семейной паре" } },
  { id: "cmt1irvh3000txab01buy30mb", key: "massage_table", group: "massage", appliesTo: [], position: 229, isActive: true, name: { de: "Massagetisch", en: "Massage table", ru: "Массажный стол" } },
  { id: "cmt1irvh4000uxab0bu7u7zet", key: "striptease_pro", group: "striptease", appliesTo: ["escort"], position: 330, isActive: true, name: { de: "Profi-Striptease", en: "Professional striptease", ru: "Стриптиз профи" } },
  { id: "cmt1irvh4000vxab0hdby065i", key: "striptease_amateur", group: "striptease", appliesTo: ["escort"], position: 331, isActive: true, name: { de: "Amateur-Striptease", en: "Amateur striptease", ru: "Стриптиз не профи" } },
  { id: "cmt1irvh5000wxab0ecwv23vk", key: "lesbi_show_light", group: "striptease", appliesTo: ["escort"], position: 332, isActive: true, name: { de: "Leichte Lesbenshow", en: "Light lesbian show", ru: "Лесби-шоу лёгкое" } },
  { id: "cmt1irvh5000xxab0o1mmijvq", key: "lesbi_explicit", group: "striptease", appliesTo: ["escort"], position: 333, isActive: true, name: { de: "Explizite Lesbenshow", en: "Explicit lesbian show", ru: "Лесби откровенное" } },
  { id: "cmt1irvh6000yxab0xq9tq69d", key: "strapon", group: "extreme", appliesTo: ["escort"], position: 434, isActive: true, name: { de: "Umschnalldildo", en: "Strap-on", ru: "Страпон" } },
  { id: "cmt1irvh6000zxab02p3jwd8k", key: "anilingus_to_client", group: "extreme", appliesTo: ["escort"], position: 435, isActive: true, name: { de: "Anilingus für den Kunden", en: "Anilingus to client", ru: "Анилингус клиенту" } },
  { id: "cmt1irvh70010xab080xjyyxa", key: "anilingus_to_me", group: "extreme", appliesTo: ["escort"], position: 436, isActive: true, name: { de: "Anilingus für mich", en: "Anilingus to me", ru: "Анилингус мне" } },
  { id: "cmt1irvh80011xab0g144k1ql", key: "golden_to_client", group: "extreme", appliesTo: ["escort"], position: 437, isActive: true, name: { de: "Natursekt aktiv", en: "Golden shower to client", ru: "Золотой дождь клиенту" } },
  { id: "cmt1irvh80012xab01hg9ucl2", key: "golden_to_me", group: "extreme", appliesTo: ["escort"], position: 438, isActive: true, name: { de: "Natursekt passiv", en: "Golden shower to me", ru: "Золотой дождь мне" } },
  { id: "cmt1irvh90013xab07jwgde5k", key: "fisting_anal_client", group: "extreme", appliesTo: ["escort"], position: 439, isActive: true, name: { de: "Anales Fisting aktiv", en: "Anal fisting to client", ru: "Фистинг анальный клиенту" } },
  { id: "cmt1irvh90014xab01pyzhcak", key: "fisting_anal_me", group: "extreme", appliesTo: ["escort"], position: 440, isActive: true, name: { de: "Anales Fisting passiv", en: "Anal fisting to me", ru: "Фистинг анальный мне" } },
  { id: "cmt1irvha0015xab0k7vs2o6y", key: "fisting_classic", group: "extreme", appliesTo: ["escort"], position: 441, isActive: true, name: { de: "Klassisches Fisting", en: "Classic fisting", ru: "Фистинг классический" } },
  { id: "cmt1irvha0016xab04ux5z8tr", key: "fingering", group: "extreme", appliesTo: ["escort"], position: 442, isActive: true, name: { de: "Fingering", en: "Fingering", ru: "Фингеринг" } },
  { id: "cmt1irvhb0017xab0nh87svk9", key: "double_penetration", group: "extreme", appliesTo: ["escort"], position: 443, isActive: true, name: { de: "Doppelpenetration", en: "Double penetration", ru: "Двойное проникновение" } },
  { id: "cmt1irvhc0018xab08hf10id7", key: "ballbusting", group: "bdsm", appliesTo: ["escort"], position: 544, isActive: true, name: { de: "Ballbusting", en: "Ballbusting", ru: "Боллбастинг" } },
  { id: "cmt1irvhc0019xab0rgexfya8", key: "mistress", group: "bdsm", appliesTo: ["escort"], position: 545, isActive: true, name: { de: "Herrin", en: "Mistress", ru: "Госпожа" } },
  { id: "cmt1irvhd001axab02p7mds6x", key: "domination", group: "bdsm", appliesTo: ["escort"], position: 546, isActive: true, name: { de: "Dominanz", en: "Domination", ru: "Доминирование" } },
  { id: "cmt1irvhd001bxab0tylms74v", key: "slave", group: "bdsm", appliesTo: ["escort"], position: 547, isActive: true, name: { de: "Sklavin", en: "Slave", ru: "Рабыня" } },
  { id: "cmt1irvhe001cxab0cy40f5ov", key: "submission", group: "bdsm", appliesTo: ["escort"], position: 548, isActive: true, name: { de: "Unterwerfung", en: "Submission", ru: "Подчинение" } },
  { id: "cmt1irvhe001dxab0uy9qnfqd", key: "bondage", group: "bdsm", appliesTo: ["escort"], position: 549, isActive: true, name: { de: "Bondage", en: "Bondage", ru: "Бондаж" } },
  { id: "cmt1irvhf001exab0mu34c47s", key: "spanking", group: "bdsm", appliesTo: ["escort"], position: 550, isActive: true, name: { de: "Spanking", en: "Spanking", ru: "Порка" } },
  { id: "cmt1irvhg001fxab01fyq3ypi", key: "fetish", group: "bdsm", appliesTo: ["escort"], position: 551, isActive: true, name: { de: "Fetisch", en: "Fetish", ru: "Фетиш" } },
  { id: "cmt1irvhg001gxab0ayha5w28", key: "trampling", group: "bdsm", appliesTo: ["escort"], position: 552, isActive: true, name: { de: "Trampling", en: "Trampling", ru: "Трамплинг" } },
  { id: "cmt1irvhh001hxab0u2e3kfwy", key: "shibari", group: "bdsm", appliesTo: ["escort"], position: 553, isActive: true, name: { de: "Shibari", en: "Shibari", ru: "Шибари" } },
  { id: "cmt1irvhi001ixab03jmfy13f", key: "facesitting", group: "bdsm", appliesTo: ["escort"], position: 554, isActive: true, name: { de: "Facesitting", en: "Facesitting", ru: "Фейсситтинг" } },
  { id: "cmt1irvhi001jxab047yzsesf", key: "copro_give", group: "bdsm", appliesTo: ["escort"], position: 555, isActive: true, name: { de: "Kaviar aktiv", en: "Copro (active)", ru: "Копро (выдача)" } },
  { id: "cmt1irvhj001kxab0vwmtj3gg", key: "copro_take", group: "bdsm", appliesTo: ["escort"], position: 556, isActive: true, name: { de: "Kaviar passiv", en: "Copro (passive)", ru: "Копро (приём)" } },
  { id: "cmt1irvhj001lxab0f85gv927", key: "squirt", group: "bdsm", appliesTo: ["escort"], position: 557, isActive: true, name: { de: "Squirt", en: "Squirt", ru: "Сквирт" } },
  { id: "cmt19n3ms000gcmb0t6t9m4qh", key: "incall", group: "format", appliesTo: [], position: 658, isActive: true, name: { de: "Bei mir", en: "Incall", ru: "У себя" } },
  { id: "cmt19n3mt000hcmb0q2wqmena", key: "outcall", group: "format", appliesTo: [], position: 659, isActive: true, name: { de: "Hausbesuch", en: "Outcall", ru: "Выезд" } },
  { id: "cmt19n3mt000icmb0fd25p3s5", key: "hotel_visit", group: "format", appliesTo: ["escort"], position: 660, isActive: true, name: { de: "Hotelbesuch", en: "Hotel visit", ru: "Визит в отель" } },
];
