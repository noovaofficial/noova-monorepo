/**
 * Справочник городов и районов. Отдельно от общего сида по той же причине,
 * что и услуги: справочник живёт дольше демо-данных и накатывается на прод,
 * где сносить анкеты нельзя.
 *
 * Район — минимальная единица местоположения: из его центра собираются
 * `Profile.approxLat/Lng`, и точнее мы местоположение не знаем и знать не
 * должны (arch/architecture.md §6). Районы необязательны: не в каждом городе
 * они осмысленны, и анкета без района получает координату центра города —
 * грубее, а значит приватнее.
 */
import type { Locale } from '@noova/shared';

export type Translated = Record<Locale, string>;

export type DistrictSeed = {
  slug: string;
  name: Translated;
  lat: number;
  lng: number;
};

export type CitySeed = {
  slug: string;
  name: Translated;
  countryCode: string;
  lat: number;
  lng: number;
  /** Необязательны: город может не делиться на районы. */
  districts: DistrictSeed[];
};

export const CITIES: CitySeed[] = [
  {
    slug: 'berlin',
    name: { de: 'Berlin', en: 'Berlin', ru: 'Берлин' },
    countryCode: 'DE',
    lat: 52.52,
    lng: 13.405,
    districts: [
      {
        slug: 'mitte',
        name: { de: 'Mitte', en: 'Mitte', ru: 'Митте' },
        lat: 52.5244,
        lng: 13.4105,
      },
      {
        slug: 'charlottenburg',
        name: { de: 'Charlottenburg', en: 'Charlottenburg', ru: 'Шарлоттенбург' },
        lat: 52.505,
        lng: 13.304,
      },
      {
        slug: 'kreuzberg',
        name: { de: 'Kreuzberg', en: 'Kreuzberg', ru: 'Кройцберг' },
        lat: 52.498,
        lng: 13.403,
      },
      {
        slug: 'prenzlauer-berg',
        name: { de: 'Prenzlauer Berg', en: 'Prenzlauer Berg', ru: 'Пренцлауэр-Берг' },
        lat: 52.539,
        lng: 13.424,
      },
      {
        slug: 'friedrichshain',
        name: { de: 'Friedrichshain', en: 'Friedrichshain', ru: 'Фридрихсхайн' },
        lat: 52.515,
        lng: 13.454,
      },
      {
        slug: 'neukoelln',
        name: { de: 'Neukölln', en: 'Neukölln', ru: 'Нойкёльн' },
        lat: 52.481,
        lng: 13.435,
      },
      {
        slug: 'schoeneberg',
        name: { de: 'Schöneberg', en: 'Schöneberg', ru: 'Шёнеберг' },
        lat: 52.483,
        lng: 13.355,
      },
      {
        slug: 'tiergarten',
        name: { de: 'Tiergarten', en: 'Tiergarten', ru: 'Тиргартен' },
        lat: 52.514,
        lng: 13.35,
      },
    ],
  },
];
