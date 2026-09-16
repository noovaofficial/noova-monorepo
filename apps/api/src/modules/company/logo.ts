import sharp, { type Metadata } from 'sharp';
import { ImageError } from '../photos/images.js';

/**
 * Логотип агентства — сильно упрощённая версия фотопайплайна: одна картинка,
 * без модерации и без набора размеров под карточку/галерею. Ни маленькая
 * иконка, ни постер форму не ломают: сторона просто не растягивается сверх
 * присланной (`withoutEnlargement`), а вписывается в квадрат заданного
 * размера (`fit: 'inside'`) — так и герб на белом фоне, и широкий баннер
 * остаются собой, не обрезаясь и не искажаясь.
 */

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);
const MAX_DIMENSION = 512;

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export type ProcessedLogo = { buffer: Buffer; width: number; height: number };

export async function processLogo(input: Buffer): Promise<ProcessedLogo> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw new ImageError('unreadable');
  }

  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new ImageError('format');
  }

  // rotate() снимает ориентацию EXIF и заодно все остальные метаданные —
  // на логотипе они бесполезны, но снимать их правильно так же, как у фото.
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height };
}
