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

/** Ширины производных. Карточка берёт мелкую, галерея — крупную.
 *  `full` открывается на весь экран (`sizes="100vw"` в лайтбоксе) — 1280
 *  было мало даже для обычного full-HD монитора, не говоря про retina:
 *  Next.js умеет только уменьшать, апскейлить нечего, и снимок выглядел
 *  мыльным. 1920 — компромисс между резкостью и весом файла. */
export const VARIANT_WIDTHS = { thumb: 320, card: 640, full: 1920 } as const;
export type VariantName = keyof typeof VARIANT_WIDTHS;

/** Лэйаут знака: тот же контур, что у `design-system/components/Logo`,
 *  плюс словесная часть, в одной координатной сетке. */
const MARK_VIEW_WIDTH = 300;
const MARK_VIEW_HEIGHT = 100;

/**
 * Вотермарка — один знак в правом нижнем углу, а не плитка: лого и
 * надпись «noova», чёрно-белые и полупрозрачные, шириной около 30% от
 * кадра. Контур знака — тот же, что в `design-system/components/Logo`,
 * но без фирменных розового/оранжевого: на чужой фотографии брендовый
 * цвет спорил бы с самим снимком, а нейтральный читается вотермаркой,
 * а не частью изображения.
 *
 * Размер и отступ зависят от итоговой ширины и высоты кадра, поэтому на
 * превью и на полном размере знак занимает одну и ту же долю кадра.
 * Отдаёт готовую позицию (`left`/`top`), а не полотно размером с фото:
 * `sharp` не может тайлить composite крупнее базового изображения (уже
 * ловили на мелких загрузках), а точечная позиция от этого не зависит.
 */
function cornerWatermark(
  imageWidth: number,
  imageHeight: number,
): { input: Buffer; left: number; top: number } {
  const marginX = Math.round(imageWidth * 0.035);
  const marginY = Math.round(imageHeight * 0.035);

  // Ширина — 30% кадра, но не шире и не выше, чем вообще есть места с
  // отступами: без этой поправки на низком широком кадре знак вылезал бы
  // за нижний край, а `sharp` отказался бы накладывать composite крупнее
  // самого изображения.
  const byWidth = imageWidth * 0.3;
  const byHeight = ((imageHeight - marginY * 2) * MARK_VIEW_WIDTH) / MARK_VIEW_HEIGHT;
  const markWidth = Math.max(24, Math.min(byWidth, byHeight, imageWidth - marginX * 2));
  const markHeight = (markWidth * MARK_VIEW_HEIGHT) / MARK_VIEW_WIDTH;

  const svg = `<svg width="${markWidth}" height="${markHeight}" viewBox="0 0 ${MARK_VIEW_WIDTH} ${MARK_VIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <g opacity="0.55" fill="none" stroke="#ffffff" stroke-linejoin="round" stroke-linecap="round">
      <path d="M44,82 C24,64 6,52 6,34 C6,20 18,12 30,16 C38,18 42,24 44,30 C46,24 50,18 58,16 C70,12 82,20 82,34 C82,52 64,64 44,82 Z" stroke-width="6"/>
      <path d="M44,68 C36,60 36,52 44,42 C52,52 52,60 44,68 Z" stroke-width="6"/>
      <text x="100" y="58" font-family="sans-serif" font-weight="800" font-size="46" stroke="none" fill="#ffffff">noova</text>
    </g>
  </svg>`;

  return {
    input: Buffer.from(svg),
    left: Math.max(0, Math.round(imageWidth - markWidth - marginX)),
    top: Math.max(0, Math.round(imageHeight - markHeight - marginY)),
  };
}

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
 *
 * Вотермарка ложится здесь же, на загрузке — а не при одобрении модератором.
 * Так модератор проверяет ровно то, что увидит посетитель, а не чистый
 * оригинал, который потом незаметно подменится.
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
    // Ресайз — отдельным шагом в png (без потерь), потому что размер и
    // положение знака зависят от итоговых ширины и высоты кадра, а они
    // известны только после withoutEnlargement. Кодируем в webp один раз,
    // уже поверх него.
    const resized = await sharp(input, { failOn: 'error' })
      // rotate() без аргументов применяет ориентацию из EXIF и снимает её:
      // иначе после удаления метаданных снимок ляжет набок.
      .rotate()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });

    const mark = cornerWatermark(resized.info.width, resized.info.height);
    const { data, info } = await sharp(resized.data)
      .composite([{ input: mark.input, left: mark.left, top: mark.top }])
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
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
