import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESERVED_CITY_SLUGS } from '@noova/shared';
import { describe, expect, it } from 'vitest';

/**
 * Проверка живёт здесь, а не рядом с константой: `packages/shared` типизирован
 * без node-API намеренно — он ходит и в браузер. Тестовое окружение с доступом
 * к файловой системе есть только у API.
 *
 * Сам список — в `packages/shared/src/locations.ts`. Город это второй сегмент
 * после языка, и это же место занимают статические маршруты: `/ru/about` и
 * `/ru/berlin` неотличимы по форме. Забыть обновить список, добавив страницу,
 * легко — и город с таким именем потом просто не откроется, без единой ошибки
 * при заведении. Пусть об этом узнает сборка, а не посетитель.
 */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/src/app/[locale]');

describe('RESERVED_CITY_SLUGS', () => {
  it('покрывает все статические маршруты под [locale]', () => {
    const routes = readdirSync(APP_DIR, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith('[') && !entry.name.startsWith('_'),
      )
      .map((entry) => entry.name);

    expect(routes.length).toBeGreaterThan(0);
    expect([...RESERVED_CITY_SLUGS].sort()).toEqual([...routes].sort());
  });
});
