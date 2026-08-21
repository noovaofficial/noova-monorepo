import sharp, { type Metadata } from 'sharp';

/** Форматы, которые принимаем. Определяются по содержимому, не по расширению. */
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_PROFILE = 20;

/**
 * Минимального разрешения нет: принимаем снимок любого размера.
 * От «бомб сжатия» защищает не он, а собственный лимит sharp на количество
 * входных пикселей (≈268 Мпикс) — маленький файл, разворачивающийся в
 * гигантский холст, отвергается на декодировании.
 *
 * Мелкое фото не растягиваем: `withoutEnlargement` оставит производные
 * меньше целевых размеров. Замыленная картинка хуже маленькой.
 */

/** Ширины производных. Карточка берёт мелкую, галерея — крупную. */
export const VARIANT_WIDTHS = { thumb: 320, card: 640, full: 1280 } as const;
export type VariantName = keyof typeof VARIANT_WIDTHS;

export class ImageError extends Error {
  constructor(readonly reason: 'format' | 'unreadable') {
    super(reason);
    this.name = 'ImageError';
  }
}

export type ProcessedImage = {
  width: number;
  height: number;
  blurDataUrl: string;
  variants: Record<VariantName, { buffer: Buffer; width: number; height: number }>;
};

/**
 * Готовит загруженный файл к публикации.
 *
 * Главное здесь — снять метаданные. Снимок с телефона несёт GPS-координаты
 * места съёмки, то есть домашний адрес. Публикация такого файла раскрыла бы
 * ровно то, что продукт специально защищает: координаты анкеты намеренно
 * огрублены до района. Полагаться на клиент нельзя, чистим на сервере.
 *
 * Формат определяется по содержимому файла: и расширение, и заголовок
 * Content-Type задаёт клиент, доверять им нельзя.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw new ImageError('unreadable');
  }

  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new ImageError('format');
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const variants = {} as ProcessedImage['variants'];

  for (const [name, targetWidth] of Object.entries(VARIANT_WIDTHS)) {
    const pipeline = sharp(input, { failOn: 'error' })
      // rotate() без аргументов применяет ориентацию из EXIF и снимает её:
      // иначе после удаления метаданных снимок ляжет набок.
      .rotate()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 82 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    variants[name as VariantName] = { buffer: data, width: info.width, height: info.height };
  }

  // Крошечная замыленная версия внутри HTML: карточка не мигает пустотой,
  // пока грузится настоящее фото, и не прыгает вёрстка.
  const blur = await sharp(input).rotate().resize({ width: 16 }).webp({ quality: 40 }).toBuffer();

  return {
    width,
    height,
    blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}`,
    variants,
  };
}

/** Проверяет, что в результате не осталось метаданных. Используется в тестах. */
export async function hasMetadata(buffer: Buffer): Promise<boolean> {
  const meta = await sharp(buffer).metadata();
  return Boolean(meta.exif || meta.icc || meta.iptc || meta.xmp);
}
