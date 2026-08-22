/**
 * Справочник городов и районов. Отдельно от общего сида по той же причине,
 * что и услуги: справочник живёт дольше демо-данных и накатывается на прод,
 * где сносить анкеты нельзя.
 *
 * Район — минимальная единица местоположения: из его центра собираются
 * `Profile.approxLat/Lng`, и точнее мы местоположение не знаем и знать не
 * должны (architecture.md §6).
 */

export type DistrictSeed = {
  slug: string;
  name: string;
  lat: number;
  lng: number;
};

export type CitySeed = {
  slug: string;
  name: string;
  countryCode: string;
  lat: number;
  lng: number;
  districts: DistrictSeed[];
};

export const CITIES: CitySeed[] = [
  {
    slug: 'berlin',
    name: 'Berlin',
    countryCode: 'DE',
    lat: 52.52,
    lng: 13.405,
    districts: [
      { slug: 'mitte', name: 'Mitte', lat: 52.5244, lng: 13.4105 },
      { slug: 'charlottenburg', name: 'Charlottenburg', lat: 52.505, lng: 13.304 },
      { slug: 'kreuzberg', name: 'Kreuzberg', lat: 52.498, lng: 13.403 },
      { slug: 'prenzlauer-berg', name: 'Prenzlauer Berg', lat: 52.539, lng: 13.424 },
      { slug: 'friedrichshain', name: 'Friedrichshain', lat: 52.515, lng: 13.454 },
      { slug: 'neukoelln', name: 'Neukölln', lat: 52.481, lng: 13.435 },
      { slug: 'schoeneberg', name: 'Schöneberg', lat: 52.483, lng: 13.355 },
      { slug: 'tiergarten', name: 'Tiergarten', lat: 52.514, lng: 13.35 },
    ],
  },
];
