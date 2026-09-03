import { describe, expect, it } from 'vitest';
import { clearFilters, countActiveFilters, parseFilters, setValue, toggleValue } from './params';

const params = (query: string) => new URLSearchParams(query);

describe('переключение многозначного фильтра', () => {
  it('добавляет значение, не теряя уже выбранные', () => {
    const next = toggleValue(params('hairColor=blonde'), 'hairColor', 'red');
    expect(next.getAll('hairColor')).toEqual(['blonde', 'red']);
  });

  it('снимает выбранное значение и оставляет остальные', () => {
    const next = toggleValue(params('hairColor=blonde&hairColor=red'), 'hairColor', 'blonde');
    expect(next.getAll('hairColor')).toEqual(['red']);
  });

  it('не трогает другие фильтры', () => {
    const next = toggleValue(params('hairColor=red&eyeColor=blue'), 'hairColor', 'black');
    expect(next.get('eyeColor')).toBe('blue');
  });
});

describe('возврат на первую страницу', () => {
  /**
   * Самая дорогая ошибка этого модуля: человек на пятой странице сужает
   * фильтр, выдача сокращается до двух позиций, и он видит пустой экран.
   * Выглядит как «фильтр ничего не нашёл», хотя нашёл.
   */
  it('смена многозначного фильтра сбрасывает номер страницы', () => {
    const next = toggleValue(params('page=5&hairColor=red'), 'hairColor', 'black');
    expect(next.has('page')).toBe(false);
  });

  it('смена однозначного фильтра сбрасывает номер страницы', () => {
    expect(setValue(params('page=5'), 'maxPriceCents', '30000').has('page')).toBe(false);
  });

  it('снятие однозначного фильтра тоже сбрасывает', () => {
    expect(
      setValue(params('page=5&maxPriceCents=30000'), 'maxPriceCents', undefined).has('page'),
    ).toBe(false);
  });
});

describe('однозначный фильтр', () => {
  it('заменяет прежнее значение, а не добавляет второе', () => {
    const next = setValue(params('maxPriceCents=30000'), 'maxPriceCents', '20000');
    expect(next.getAll('maxPriceCents')).toEqual(['20000']);
  });

  it('пустая строка убирает параметр, а не пишет пустое значение', () => {
    // «?maxPriceCents=» доехало бы до сервера и не прошло бы схему.
    expect(setValue(params('maxPriceCents=30000'), 'maxPriceCents', '').has('maxPriceCents')).toBe(
      false,
    );
  });
});

describe('сброс фильтров', () => {
  it('оставляет структурные параметры и убирает остальные', () => {
    const next = clearFilters(params('kind=escort&sort=fresh&hairColor=red&languages=de'));
    expect(next.get('kind')).toBe('escort');
    expect(next.get('sort')).toBe('fresh');
    expect(next.has('hairColor')).toBe(false);
    expect(next.has('languages')).toBe(false);
  });

  it('не тащит за собой позицию в выдаче', () => {
    // `page` и `cursor` структурные, но относятся к прошлому набору фильтров:
    // сохранив их, сброс оставил бы человека на странице, которой больше нет.
    const next = clearFilters(params('kind=escort&page=4&cursor=abc'));
    expect(next.has('page')).toBe(false);
    expect(next.has('cursor')).toBe(false);
  });
});

describe('счётчик применённых фильтров', () => {
  it('считает каждое значение многозначного параметра', () => {
    expect(countActiveFilters(params('hairColor=red&hairColor=black&eyeColor=blue'))).toBe(3);
  });

  it('не считает структурные параметры', () => {
    // Иначе бейдж на кнопке горел бы на чистом каталоге: `kind` и `sort`
    // там есть всегда.
    expect(countActiveFilters(params('kind=escort&sort=fresh&page=2&limit=24'))).toBe(0);
  });

  it('не считает пустые значения', () => {
    expect(countActiveFilters(params('hairColor=&eyeColor=blue'))).toBe(1);
  });
});

describe('разбор адреса', () => {
  it('мусор не роняет страницу, а даёт каталог без фильтров', () => {
    // Адрес правят руками и присылают ссылками; ошибка в нём не повод
    // показать посетителю страницу ошибки вместо каталога.
    const parsed = parseFilters({ maxPriceCents: 'не-число', hairColor: ['несуществующий-цвет'] });
    expect(parsed).toBeTruthy();
    expect(parsed.hairColor).toBeUndefined();
  });

  it('пропущенные параметры не превращаются в undefined-значения', () => {
    const parsed = parseFilters({ kind: 'escort', maxPriceCents: undefined });
    expect(parsed.kind).toBe('escort');
    expect(parsed.maxPriceCents).toBeUndefined();
  });
});
