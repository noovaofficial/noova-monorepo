import { describe, expect, it } from 'vitest';
import { isOnline, toCity, toMoney, toProfileCard } from './mappers';

const city = {
  slug: 'berlin',
  name: 'Berlin',
  country: { code: 'DE' },
  translations: [{ name: 'Берлин' }],
};

describe('toCity', () => {
  /**
   * `City.name` — техническое имя для админки и журналов. Посетителю идёт
   * перевод; подстановка технического имени была бы не ошибкой рендера, а
   * тихо неверным языком на странице (N-35).
   */
  it('берёт перевод, а не техническое имя', () => {
    expect(toCity(city)).toEqual({ slug: 'berlin', name: 'Берлин', countryCode: 'DE' });
  });

  /**
   * Перевода не может не быть — контракт не даёт сохранить неполный набор.
   * Но если он всё же пропал, показать немецкое название честнее, чем
   * уронить весь каталог пятисоткой из-за одной строки.
   */
  it('без перевода отдаёт техническое имя, а не падает', () => {
    expect(toCity({ ...city, translations: [] }).name).toBe('Berlin');
    expect(toCity({ ...city, translations: undefined }).name).toBe('Berlin');
  });
});

describe('toMoney', () => {
  it('различает отсутствие цены и ноль', () => {
    expect(toMoney(null)).toBeNull();
    expect(toMoney(0)).toEqual({ amountCents: 0, currency: 'EUR' });
  });
});

describe('isOnline', () => {
  /** Онлайн — «был активен последние 10 минут», отдельного флага в БД нет. */
  it('считает по окну в десять минут', () => {
    expect(isOnline(null)).toBe(false);
    expect(isOnline(new Date(Date.now() - 60 * 1000))).toBe(true);
    expect(isOnline(new Date(Date.now() - 11 * 60 * 1000))).toBe(false);
  });
});

const cardRow = {
  id: 'p1',
  slug: 'kris',
  kind: 'escort' as const,
  displayName: 'Kris',
  age: 24,
  fromPriceCents: 15000,
  isVerified: true,
  isFeatured: false,
  lastSeenAt: null,
  city,
  district: { name: 'Mitte', translations: [{ name: 'Митте' }] },
  company: null,
  photos: [],
  services: Array.from({ length: 9 }, (_, i) => ({
    service: { key: `s${i}`, translations: [{ name: `Услуга ${i}` }] },
  })),
};

describe('toProfileCard', () => {
  it('переводит город, район и услуги', () => {
    const card = toProfileCard(cardRow);
    expect(card.city.name).toBe('Берлин');
    expect(card.district).toBe('Митте');
    expect(card.services[0]).toEqual({ key: 's0', name: 'Услуга 0' });
  });

  /**
   * Карточка показывает до шести тегов. Контракт ограничивает массив шестью
   * элементами, и лишние услуги уронили бы ответ на разборе схемы — то есть
   * весь листинг, а не одну карточку.
   */
  it('обрезает услуги до шести', () => {
    expect(toProfileCard(cardRow).services).toHaveLength(6);
  });

  it('анкета без района отдаёт null, а не пустую строку', () => {
    expect(toProfileCard({ ...cardRow, district: null }).district).toBeNull();
  });

  it('услуга без перевода показывается ключом, а не пропадает', () => {
    const card = toProfileCard({
      ...cardRow,
      services: [{ service: { key: 'sauna', translations: [] } }],
    });
    expect(card.services[0]).toEqual({ key: 'sauna', name: 'sauna' });
  });
});
