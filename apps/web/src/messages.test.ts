import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import de from '../messages/de.json';
import en from '../messages/en.json';
import ru from '../messages/ru.json';

type Dict = Record<string, Record<string, string>>;
const LOCALES: Record<string, Dict> = { ru: ru as Dict, en: en as Dict, de: de as Dict };

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

/**
 * Неймспейсы, ключи которых приходят из данных, а не пишутся в коде: значения
 * перечислений БД, коды языков, типы контактов. Найти их упоминание в
 * исходниках нельзя в принципе — `t(profile.hairColor)` не содержит ни
 * `blonde`, ни `brunette`, — поэтому проверка «ключ есть, а кода нет» их
 * пропускает. Плата за это известна: мёртвый статический ключ в таком
 * неймспейсе (скажем, `contacts.note`) она не поймает.
 */
const DATA_DRIVEN = new Set([
  'appearanceType',
  'bodyType',
  'breastSize',
  'breastType',
  'contacts',
  'eyeColor',
  'hairColor',
  'languageNames',
  'pubicHair',
  'services',
]);

/**
 * Ключи, которых нет в словаре, роняют страницу в рантайме — а сборка их
 * не ловит, если компонент клиентский и при пререндере не открывается.
 * Так панель фильтров уехала в работу с двенадцатью недостающими строками.
 */
describe('словари локалей', () => {
  it('содержат одинаковый набор ключей', () => {
    const keysOf = (dict: Dict) =>
      new Set(
        Object.entries(dict).flatMap(([ns, values]) =>
          Object.keys(values).map((k) => `${ns}.${k}`),
        ),
      );

    const ruKeys = keysOf(LOCALES.ru as Dict);
    for (const locale of ['en', 'de'] as const) {
      const other = keysOf(LOCALES[locale] as Dict);
      expect(
        [...ruKeys].filter((k) => !other.has(k)),
        `нет в ${locale}`,
      ).toEqual([]);
      expect(
        [...other].filter((k) => !ruKeys.has(k)),
        `лишние в ${locale}`,
      ).toEqual([]);
    }
  });

  it('не содержат пустых значений', () => {
    for (const [locale, dict] of Object.entries(LOCALES)) {
      for (const [ns, values] of Object.entries(dict)) {
        for (const [key, value] of Object.entries(values)) {
          expect(String(value).trim(), `${locale}: ${ns}.${key}`).not.toBe('');
        }
      }
    }
  });

  /**
   * Компоненты берут неймспейс через `useTranslations('ns')`, а дальше зовут
   * `t('key')`. Сверяем эти пары со словарём.
   */
  it('покрывают ключи, которые запрашивают компоненты', () => {
    const missing: string[] = [];

    for (const file of walk(join(import.meta.dirname))) {
      const source = readFileSync(file, 'utf8');
      // Сопоставляем переменную с её неймспейсом: const t = useTranslations('x')
      const namespaces = new Map<string, string>();
      for (const m of source.matchAll(
        /const\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*(?:\{[^}]*namespace:\s*)?'([^']+)'/g,
      )) {
        namespaces.set(m[1] as string, m[2] as string);
      }

      for (const [variable, namespace] of namespaces) {
        const calls = source.matchAll(new RegExp(`\\b${variable}\\('([a-zA-Z][\\w]*)'\\)`, 'g'));
        for (const call of calls) {
          const key = call[1] as string;
          if (!(LOCALES.ru as Dict)[namespace]?.[key]) {
            missing.push(`${namespace}.${key} (${file.split('/src/')[1]})`);
          }
        }
      }
    }

    expect([...new Set(missing)]).toEqual([]);
  });

  /**
   * Обратная проверка: ключ есть в словаре, а в коде его нет.
   *
   * Так копится мусор — `account.tags` пережил снос `Profile.tags`, а
   * `footer.impressum` ждёт страниц, которых нет. Сам по себе лишний ключ
   * безвреден, но он попадает в бандл, уезжает переводчику и создаёт
   * впечатление, что функция есть.
   *
   * Проверка нарочно **грубее** предыдущей и сопоставлять переменную с её
   * неймспейсом не пытается: в странице анкеты `t` приходит из
   * деструктуризации `Promise.all`, и точное сопоставление там врёт, объявляя
   * мёртвыми сорок живых ключей. Здесь достаточно, чтобы имя ключа
   * встречалось в исходниках хоть где-нибудь. Цена — пропущенный ключ, чьё
   * имя совпало с чем-то посторонним; это лучше, чем предложить удалить
   * работающую подпись.
   */
  it('не содержат ключей, которых нет в коде', () => {
    const sources = walk(join(import.meta.dirname))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    // Ключи, собранные шаблоном: t(`period_${x}`) и t(`${key}Title`).
    const prefixes = [...sources.matchAll(/\(\s*`([a-zA-Z][\w]*?)\$\{/g)].map(
      (m) => m[1] as string,
    );
    const suffixes = [...sources.matchAll(/\(\s*`\$\{[^}]*\}([a-zA-Z][\w]*)`/g)].map(
      (m) => m[1] as string,
    );

    const dead: string[] = [];
    for (const [ns, values] of Object.entries(LOCALES.ru as Dict)) {
      if (DATA_DRIVEN.has(ns)) continue;
      for (const key of Object.keys(values)) {
        if (new RegExp(`['"\`]${key}['"\`]`).test(sources)) continue;
        if (prefixes.some((p) => key.startsWith(p))) continue;
        if (suffixes.some((suffix) => key.endsWith(suffix))) continue;
        dead.push(`${ns}.${key}`);
      }
    }

    expect(dead, 'есть в словаре, но не используются в коде').toEqual([]);
  });
});
