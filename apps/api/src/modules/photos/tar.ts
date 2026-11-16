/**
 * Минимальный tar (формат ustar) — ровно столько, сколько нужно бэкапу
 * медиа: обычные файлы с известным размером, потоком в обе стороны.
 *
 * Своя реализация, а не пакет: архив собирается из листинга хранилища, где
 * размер каждого объекта известен заранее, и весь формат — это заголовок в
 * 512 байт перед содержимым. Тянуть ради этого зависимость в прод-образ
 * незачем. Совместимость проверяется тестом против системного `tar`.
 */

const BLOCK = 512;

/** Имя длиннее 100 байт ustar делит на «префикс» и «имя» по косой черте. */
function splitName(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  for (let i = name.indexOf('/'); i !== -1; i = name.indexOf('/', i + 1)) {
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  throw new Error(`Имя не помещается в заголовок tar: ${name}`);
}

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

/** Заголовок обычного файла. */
export function tarHeader(path: string, size: number, mtime = new Date()): Buffer {
  const { name, prefix } = splitName(path);
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100);
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(size, 12), 124);
  header.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136);
  // Контрольная сумма считается так, будто её поле заполнено пробелами.
  header.fill(' ', 148, 156);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}

/** Сколько нулей дописать после содержимого, чтобы добить до блока. */
export function tarPadding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

/** Конец архива — два пустых блока. */
export const TAR_END = Buffer.alloc(BLOCK * 2);

export type TarEntry = { path: string; size: number; isFile: boolean };

/** Разбор заголовка. `null` — пустой блок, то есть конец архива. */
export function parseTarHeader(header: Buffer): TarEntry | null {
  if (header.every((byte) => byte === 0)) return null;
  const text = (start: number, length: number) => {
    const end = header.indexOf(0, start);
    return header.toString(
      'utf8',
      start,
      end === -1 || end > start + length ? start + length : end,
    );
  };
  const name = text(0, 100);
  const prefix = text(345, 155);
  const size = Number.parseInt(text(124, 12).trim() || '0', 8);
  if (!Number.isFinite(size)) throw new Error('Повреждённый заголовок tar');
  const type = header[156];
  return {
    path: prefix ? `${prefix}/${name}` : name,
    size,
    // «0» и пустой байт — обычный файл; каталоги и служебные записи пропускаем.
    isFile: type === 0x30 || type === 0,
  };
}

/**
 * Читает из потока ровно столько байт, сколько просят: tar режется на блоки
 * фиксированного размера, а поток отдаёт куски произвольной длины.
 */
export class ByteReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private rest: Buffer = Buffer.alloc(0);

  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  /** Следующий кусок не длиннее `max`; `null` — поток кончился. */
  async chunk(max: number): Promise<Buffer | null> {
    if (this.rest.length === 0) {
      const next = await this.iterator.next();
      if (next.done) return null;
      this.rest = next.value;
    }
    const out = this.rest.subarray(0, max);
    this.rest = this.rest.subarray(out.length);
    return out;
  }

  /** Ровно `length` байт; `null`, если поток кончился раньше. */
  async exact(length: number): Promise<Buffer | null> {
    const parts: Buffer[] = [];
    let got = 0;
    while (got < length) {
      const part = await this.chunk(length - got);
      if (!part) return null;
      parts.push(part);
      got += part.length;
    }
    return Buffer.concat(parts);
  }

  /** Отдаёт следующие `length` байт кусками — содержимое одного файла. */
  async *take(length: number): AsyncGenerator<Buffer> {
    let left = length;
    while (left > 0) {
      const part = await this.chunk(left);
      if (!part) throw new Error('Архив оборван посреди файла');
      left -= part.length;
      yield part;
    }
  }
}
