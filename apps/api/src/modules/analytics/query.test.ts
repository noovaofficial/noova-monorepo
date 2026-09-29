import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { berlinDate, loadAnalytics } from './query.js';

/**
 * Полдень по Берлину, чтобы «сегодня» в тесте не зависело от того, в каком
 * поясе он запущен: у полуночи UTC берлинская дата уже другая.
 */
const NOW = new Date('2026-09-03T10:00:00Z');

type Row = Record<string, unknown>;

/**
 * Пять запросов статистики различаются текстом, а не порядком: `Promise.all`
 * их не упорядочивает, и раскладывать ответы по индексу вызова значит
 * привязать тест к тому, чего он не контролирует. Каждый узнаётся по своему
 * уникальному куску SQL — единственному месту, где он встречается:
 * `"contactType"` только в запросе каналов, `DISTINCT` только в запросе
 * уникальных посетителей, `registered` только в посуточных бакетах,
 * `"view"` в JSON-параметре — это `FUNNEL_KINDS` (там есть `view`), которого
 * нет в `CONTACT_EVENT_KINDS` запроса «слот не работает».
 */
function fakePrisma(
  rows: {
    buckets?: Row[];
    profiles?: Row[];
    contacts?: Row[];
    viewers?: Row[];
    contacts30?: Row[];
  } = {},
) {
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    // Куски запроса, собранные через `Prisma.sql`, лежат в значениях, а не
    // в статических строках: без них текст запроса читается неполным.
    const sql = [...strings, ...values.map((value) => JSON.stringify(value))].join(' ');
    if (sql.includes('"contactType"')) return Promise.resolve(rows.contacts ?? []);
    if (sql.includes('DISTINCT')) return Promise.resolve(rows.viewers ?? []);
    if (sql.includes('registered')) return Promise.resolve(rows.buckets ?? []);
    if (sql.includes('"view"')) return Promise.resolve(rows.profiles ?? []);
    return Promise.resolve(rows.contacts30 ?? []);
  });
  // biome-ignore lint/suspicious/noExplicitAny: подделка ровно того куска клиента, который нужен запросу
  return { $queryRaw: queryRaw } as any as PrismaClient;
}

const scope = (count = 1) => ({
  profiles: Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    displayName: `Анкета ${i}`,
    slug: `anketa-${i}`,
  })),
  ownerId: 'owner',
});

describe('период отчёта', () => {
  it('заканчивается сегодняшним днём и содержит ровно столько суток, сколько выбрано', async () => {
    const result = await loadAnalytics(fakePrisma(), scope(), 'd7', NOW);

    expect(result.to).toBe('2026-09-03');
    // Семь дней — это сегодня и шесть предыдущих, а не сегодня и семь:
    // иначе «неделя» показывала бы восемь столбиков.
    expect(result.from).toBe('2026-08-28');
    expect(result.series).toHaveLength(7);
  });

  it('считает сутки по Берлину, а не по UTC', () => {
    // 23:30 UTC — это уже следующий день в Берлине. Считай мы по UTC,
    // вечерний пик заходов уезжал бы в отчёте на сутки назад.
    expect(berlinDate(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
  });

  it('не теряет день на переводе часов', async () => {
    // В ночь на 29 марта 2026 сутки короче на час. Арифметика по моменту
    // времени здесь съедала бы день, и в ряду оставалось бы 29 столбиков.
    const result = await loadAnalytics(
      fakePrisma(),
      scope(),
      'd30',
      new Date('2026-04-05T10:00:00Z'),
    );
    expect(result.series).toHaveLength(30);
    expect(result.series.at(0)?.date).toBe('2026-03-07');
    expect(result.series.at(-1)?.date).toBe('2026-04-05');
  });
});

describe('часовой пояс в запросе', () => {
  it('сначала объявляет время UTC и только потом переводит в Берлин', async () => {
    const prisma = fakePrisma();
    await loadAnalytics(prisma, scope(), 'd7', NOW);

    // Prisma хранит `DateTime` в `timestamp` без пояса. Одиночное
    // `AT TIME ZONE 'Europe/Berlin'` над такой колонкой не переводит время
    // в Берлин, а объявляет берлинским — и сдвигает его в обратную сторону:
    // событие в 22:40 UTC уезжало во вчерашний столбик, а итоги при этом
    // оставались верными, так что расхождение видно было только на графике.
    const sql = vi.mocked(prisma.$queryRaw).mock.calls.flatMap((call) => JSON.stringify(call));
    expect(sql.join(' ')).toContain("AT TIME ZONE 'UTC' AT TIME ZONE");
  });
});

describe('раскладка событий', () => {
  it('делит каждое событие на вошедших и гостей', async () => {
    const prisma = fakePrisma({
      buckets: [
        { day: '2026-09-03', kind: 'view', registered: true, n: 4 },
        { day: '2026-09-03', kind: 'view', registered: false, n: 11 },
        { day: '2026-09-02', kind: 'contact_reveal', registered: false, n: 3 },
      ],
    });

    const result = await loadAnalytics(prisma, scope(), 'd7', NOW);

    expect(result.totals.views).toEqual({ total: 15, registered: 4, anonymous: 11 });
    expect(result.totals.contactReveals).toEqual({ total: 3, registered: 0, anonymous: 3 });
    // Событий этого вида не было вовсе — нули, а не отсутствующий ключ:
    // карточка должна показать «0», а не пустое место.
    expect(result.totals.contactClicks).toEqual({ total: 0, registered: 0, anonymous: 0 });
  });

  it('раскладывает дни по своим местам и оставляет пустые нулями', async () => {
    const prisma = fakePrisma({
      buckets: [{ day: '2026-08-30', kind: 'favorite', registered: true, n: 2 }],
    });

    const result = await loadAnalytics(prisma, scope(), 'd7', NOW);
    const byDate = new Map(result.series.map((point) => [point.date, point]));

    expect(byDate.get('2026-08-30')?.favorites).toBe(2);
    expect(byDate.get('2026-08-31')?.favorites).toBe(0);
    // Пустых дней в ряду нет: разрыв читался бы как «данных нет».
    expect(result.series.every((point) => typeof point.views === 'number')).toBe(true);
  });

  it('отдаёт все четыре канала связи, включая ни разу не нажатые', async () => {
    const prisma = fakePrisma({ contacts: [{ contactType: 'whatsapp', n: 7 }] });

    const result = await loadAnalytics(prisma, scope(), 'd7', NOW);

    expect(result.contacts).toEqual([
      { type: 'phone', clicks: 0 },
      { type: 'whatsapp', clicks: 7 },
      { type: 'telegram', clicks: 0 },
      { type: 'viber', clicks: 0 },
    ]);
  });
});

describe('разбивка по анкетам', () => {
  it('не строится, когда анкета одна', async () => {
    const prisma = fakePrisma({ profiles: [{ profileId: 'p0', kind: 'view', n: 5 }] });
    const result = await loadAnalytics(prisma, scope(1), 'd7', NOW);

    // У индивидуалки и салона анкета единственная, и таблица из одной
    // строки повторяла бы карточки итогов.
    expect(result.profiles).toEqual([]);
  });

  it('ставит самую заметную анкету первой и не пропускает пустые', async () => {
    const prisma = fakePrisma({
      profiles: [
        { profileId: 'p0', kind: 'view', n: 3 },
        { profileId: 'p2', kind: 'view', n: 9 },
        { profileId: 'p2', kind: 'contact_click', n: 4 },
      ],
    });

    const result = await loadAnalytics(prisma, scope(3), 'd7', NOW);

    expect(result.profiles.map((row) => row.profileId)).toEqual(['p2', 'p0', 'p1']);
    expect(result.profiles[0]).toMatchObject({ views: 9, contactClicks: 4 });
    // Анкета без единого события остаётся в таблице: её отсутствие
    // выглядело бы как удалённая, а не как никем не открытая.
    expect(result.profiles.at(-1)).toMatchObject({ profileId: 'p1', views: 0 });
  });

  /**
   * Доступ (фаза 5): таблица строится проходом по `scope.profiles`, а не по
   * тому, что вернула база, — строка для чужой анкеты в ответе `$queryRaw`
   * (например, из-за будущей ошибки в WHERE-фильтре SQL) не должна попасть
   * в отчёт этого рекламодателя ни при каких обстоятельствах. Настоящий
   * запрос и так фильтрует по `profileId = ANY(ids)`; этот тест —
   * дополнительный слой на случай, если фильтр когда-нибудь сломается.
   */
  it('не включает анкету, которой нет в scope, даже если для неё пришли строки', async () => {
    const prisma = fakePrisma({
      profiles: [
        { profileId: 'p0', kind: 'view', n: 3 },
        { profileId: 'evil-someone-elses-profile', kind: 'view', n: 999 },
      ],
      viewers: [{ day: '2026-09-03', profileId: 'evil-someone-elses-profile', n: 500 }],
      contacts30: [{ profileId: 'evil-someone-elses-profile', n: 1 }],
    });

    const result = await loadAnalytics(prisma, scope(2), 'd7', NOW);

    expect(result.profiles.map((row) => row.profileId)).toEqual(['p0', 'p1']);
    expect(result.profiles.some((row) => row.profileId === 'evil-someone-elses-profile')).toBe(
      false,
    );
  });
});

describe('уникальные посетители', () => {
  it('суммируется по дням в график и по анкетам в таблицу без пересечения', async () => {
    const prisma = fakePrisma({
      viewers: [
        { day: '2026-09-03', profileId: 'p0', n: 5 },
        { day: '2026-09-03', profileId: 'p1', n: 2 },
        { day: '2026-09-02', profileId: 'p0', n: 3 },
      ],
    });

    const result = await loadAnalytics(prisma, scope(2), 'd7', NOW);
    const byDate = new Map(result.series.map((point) => [point.date, point]));

    expect(result.totals.uniqueViewers).toEqual({ total: 10, registered: 0, anonymous: 10 });
    expect(byDate.get('2026-09-03')?.uniqueViewers).toBe(7);
    expect(byDate.get('2026-09-02')?.uniqueViewers).toBe(3);

    const byProfile = new Map(result.profiles.map((row) => [row.profileId, row.uniqueViewers]));
    expect(byProfile.get('p0')).toBe(8);
    expect(byProfile.get('p1')).toBe(2);
  });
});

describe('«слот не работает»', () => {
  it('помечает анкету без контактов за 30 дней, не за выбранный период', async () => {
    const prisma = fakePrisma({ contacts30: [{ profileId: 'p0', n: 1 }] });
    const result = await loadAnalytics(prisma, scope(2), 'd7', NOW);

    const byProfile = new Map(result.profiles.map((row) => [row.profileId, row.hasNoContacts30d]));
    expect(byProfile.get('p0')).toBe(false);
    // Ни одной строки для p1 — контактов не было вовсе, флаг всё равно есть.
    expect(byProfile.get('p1')).toBe(true);
  });
});

describe('рекламодатель без анкет', () => {
  it('получает пустой отчёт, а не ошибку', async () => {
    const prisma = fakePrisma();
    const result = await loadAnalytics(prisma, { profiles: [], ownerId: 'owner' }, 'd30', NOW);

    expect(result.totals.views.total).toBe(0);
    expect(result.series).toHaveLength(30);
    // Запроса к базе не было вовсе: собирать `IN ()` не из чего.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
