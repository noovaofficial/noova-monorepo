import { describe, expect, it } from 'vitest';
import { profileQuerySchema } from './profile';

const parse = (input: Record<string, unknown>) => profileQuerySchema.parse(input);

/**
 * Регрессия, стоившая пятисотки на публичном маршруте.
 *
 * Параметры внешности ложатся в `where` по колонке-перечислению, и значение
 * вне набора Postgres не принимает: `GET /profiles?eyeColor=xxx` отвечал
 * «внутренняя ошибка сервера». Попасть туда проще простого — правка адреса
 * руками, старая ссылка после переименования значения, бот с обрезанным
 * параметром. Каталог обязан открыться в любом из этих случаев.
 */
describe('негодные значения в фильтрах внешности', () => {
  it('отбрасываются, а не роняют разбор', () => {
    const query = parse({ eyeColor: 'такого-цвета-нет' });
    expect(query.eyeColor).toBeUndefined();
  });

  it('не утаскивают за собой годные значения того же параметра', () => {
    // Строгий enum внутри массива завалил бы разбор целиком, и вместе с
    // опечаткой потерялся бы выбранный человеком цвет.
    expect(parse({ hairColor: ['red', 'такого-нет'] }).hairColor).toEqual(['red']);
  });

  it('не утаскивают за собой соседние фильтры', () => {
    const query = parse({ eyeColor: 'blue', hairColor: 'такого-нет', kind: 'escort' });
    expect(query.eyeColor).toEqual(['blue']);
    expect(query.hairColor).toBeUndefined();
    expect(query.kind).toBe('escort');
  });

  it('проверяются у всех семи параметров внешности', () => {
    // Перечисление поимённо, а не циклом по схеме: пропустить поле при
    // добавлении нового — ровно та ошибка, которую тест обязан поймать,
    // а цикл по схеме подхватил бы новое поле и промолчал.
    const query = parse({
      hairColor: 'нет',
      eyeColor: 'нет',
      breastSize: 'нет',
      breastType: 'нет',
      bodyType: 'нет',
      pubicHair: 'нет',
      appearanceType: 'нет',
    });
    expect([
      query.hairColor,
      query.eyeColor,
      query.breastSize,
      query.breastType,
      query.bodyType,
      query.pubicHair,
      query.appearanceType,
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('годные значения проходят и поодиночке, и списком', () => {
    expect(parse({ breastSize: 'c' }).breastSize).toEqual(['c']);
    expect(parse({ bodyType: ['slim', 'athletic'] }).bodyType).toEqual(['slim', 'athletic']);
  });
});

/**
 * Услуги и языки нарочно остались свободными строками: справочник услуг
 * редактируется из админки, а языки лежат в текстовом массиве. Негодное
 * значение там просто ничему не соответствует и пятисотки не даёт —
 * закрывать их перечислением нечем и незачем.
 */
describe('параметры без закрытого набора', () => {
  it('пропускают незнакомое значение как есть', () => {
    expect(parse({ services: 'неведомая-услуга' }).services).toEqual(['неведомая-услуга']);
    expect(parse({ languages: 'xx' }).languages).toEqual(['xx']);
  });
});
