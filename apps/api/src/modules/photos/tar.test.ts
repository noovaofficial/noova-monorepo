import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ByteReader, parseTarHeader, TAR_END, tarHeader, tarPadding } from './tar.js';

const LONG = `public/${'a'.repeat(60)}/video-${'b'.repeat(60)}/poster.webp`;
const files: [string, Buffer][] = [
  ['pending/p1/photo/full.webp', Buffer.alloc(1300, 1)],
  ['public/p1/photo/thumb.webp', Buffer.alloc(512, 2)],
  ['verification/r1/face.webp', Buffer.alloc(0)],
  [LONG, Buffer.from('длинное имя')],
];

function archive(): Buffer {
  const parts: Buffer[] = [];
  for (const [path, body] of files)
    parts.push(tarHeader(path, body.length), body, tarPadding(body.length));
  return Buffer.concat([...parts, TAR_END]);
}

describe('tar для бэкапа медиа', () => {
  it('архив читается системным tar и распаковывается без потерь', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tar-'));
    writeFileSync(join(dir, 'a.tar'), archive());
    const listed = execFileSync('tar', ['tf', join(dir, 'a.tar')])
      .toString()
      .trim()
      .split('\n');
    expect(listed).toEqual(files.map(([path]) => path));
    execFileSync('tar', ['xf', join(dir, 'a.tar'), '-C', dir]);
    for (const [path, body] of files) expect(readFileSync(join(dir, path)).equals(body)).toBe(true);
  });

  it('свой разбор возвращает те же имена и содержимое при любой нарезке потока', async () => {
    const data = archive();
    // Куски по 300 байт: граница почти никогда не совпадает с блоком tar.
    const chunks: Buffer[] = [];
    for (let i = 0; i < data.length; i += 300) chunks.push(data.subarray(i, i + 300));
    const reader = new ByteReader(Readable.from(chunks));

    const seen: [string, Buffer][] = [];
    for (;;) {
      const header = await reader.exact(512);
      const entry = header && parseTarHeader(header);
      if (!entry) break;
      const body: Buffer[] = [];
      for await (const part of reader.take(entry.size)) body.push(part);
      await reader.exact(tarPadding(entry.size).length);
      seen.push([entry.path, Buffer.concat(body)]);
    }
    expect(seen.map(([path]) => path)).toEqual(files.map(([path]) => path));
    for (const [index, [, body]] of files.entries())
      expect(seen[index]?.[1].equals(body)).toBe(true);
  });

  it('читает архив, собранный системным tar, и пропускает всё, кроме файлов', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tar-'));
    execFileSync('mkdir', ['-p', join(dir, 'src/public/p1')]);
    writeFileSync(join(dir, 'src/public/p1/full.webp'), Buffer.alloc(700, 9));
    // Формат по умолчанию (у bsdtar — pax): в нём кроме файлов идут каталоги
    // и служебные записи, и разбор обязан их пропустить, не сбившись.
    execFileSync('tar', ['cf', join(dir, 'b.tar'), '-C', join(dir, 'src'), 'public']);
    const reader = new ByteReader(Readable.from([readFileSync(join(dir, 'b.tar'))]));
    const found: string[] = [];
    for (;;) {
      const header = await reader.exact(512);
      const entry = header && parseTarHeader(header);
      if (!entry) break;
      for await (const _ of reader.take(entry.size)) void _;
      await reader.exact(tarPadding(entry.size).length);
      if (entry.isFile) found.push(entry.path);
    }
    // macOS подкладывает в архив служебные файлы `._имя` — к делу не относятся.
    expect(found.filter((path) => !path.includes('._'))).toEqual(['public/p1/full.webp']);
  });

  it('отказывается от имени, которое не помещается в заголовок', () => {
    expect(() => tarHeader('x'.repeat(300), 1)).toThrow();
  });
});
