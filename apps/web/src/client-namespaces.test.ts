import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRIVATE_CLIENT_NAMESPACES,
  PUBLIC_CLIENT_NAMESPACES,
} from './shared/i18n/client-namespaces';

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

/** Файлы с директивой `use client` — только их словарь уезжает в браузер. */
function clientNamespaces(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const file of walk(join(import.meta.dirname))) {
    const source = readFileSync(file, 'utf8');
    if (!/^\s*(['"])use client\1/.test(source)) continue;

    for (const m of source.matchAll(/useTranslations\(\s*'([^']+)'/g)) {
      const ns = m[1] as string;
      found.set(ns, [...(found.get(ns) ?? []), file.split('/src/')[1] as string]);
    }
  }
  return found;
}

/**
 * Клиенту отдаётся не весь словарь: приватные разделы добавляются вложенными
 * провайдерами в своих маршрутах. Забытый в списке неймспейс не сломает
 * сборку — он падает в рантайме, когда компонент отрисуется. Пусть падает
 * здесь.
 */
describe('разделы словаря для браузера', () => {
  const declared = new Set<string>([...PUBLIC_CLIENT_NAMESPACES, ...PRIVATE_CLIENT_NAMESPACES]);

  it('покрывают все неймспейсы клиентских компонентов', () => {
    const used = clientNamespaces();
    const missing = [...used.keys()]
      .filter((ns) => !declared.has(ns))
      .map((ns) => `${ns} (${used.get(ns)?.join(', ')})`);

    expect(missing, 'не объявлены в client-namespaces.ts').toEqual([]);
  });

  it('не содержат лишнего', () => {
    const used = new Set(clientNamespaces().keys());
    expect(
      [...declared].filter((ns) => !used.has(ns)),
      'объявлены, но не нужны',
    ).toEqual([]);
  });

  /**
   * Приватный раздел, попавший в компонент вне своего маршрута, отрисуется
   * без словаря: вложенный провайдер туда не достаёт. Проверяем по модулю,
   * которому компонент принадлежит.
   */
  it('приватные разделы используются только в своих модулях', () => {
    const allowed: Record<string, RegExp> = {
      account: /^modules\/account\//,
      analytics: /^modules\/analytics\//,
      settings: /^modules\/account\//,
      billing: /^modules\/billing\//,
      campaigns: /^modules\/(campaigns|billing)\//,
      admin: /^modules\/moderation\//,
      moderation: /^modules\/moderation\//,
      locations: /^modules\/locations\//,
    };

    const wrong: string[] = [];
    for (const [ns, files] of clientNamespaces()) {
      const rule = allowed[ns];
      if (!rule) continue;
      for (const file of files) {
        if (!rule.test(file)) wrong.push(`${ns} в ${file}`);
      }
    }
    expect(wrong, 'приватный раздел вне своего маршрута').toEqual([]);
  });
});
