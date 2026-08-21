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
});
