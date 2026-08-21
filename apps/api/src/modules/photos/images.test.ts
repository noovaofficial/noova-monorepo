import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { hasMetadata, ImageError, processImage } from './images';

/** Снимок с EXIF, включая GPS-координаты — то, что несёт любое фото с телефона. */
async function photoWithGps(width = 800, height = 1000): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 150 } },
  })
    .withExifMerge({
      IFD0: { Model: 'iPhone 15 Pro', Software: 'test' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '52/1 31/1 12/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '13/1 24/1 18/1',
      },
    })
    .jpeg()
    .toBuffer();
}

describe('обработка фотографий', () => {
  it('исходник действительно содержит GPS — иначе тест ничего не проверяет', async () => {
    const original = await photoWithGps();
    expect(await hasMetadata(original)).toBe(true);

    const exif = (await sharp(original).metadata()).exif;
    expect(exif?.toString('latin1')).toContain('iPhone');
  });

  it('вычищает метаданные из всех производных', async () => {
    const processed = await processImage(await photoWithGps());

    for (const [name, variant] of Object.entries(processed.variants)) {
      expect(await hasMetadata(variant.buffer), `вариант ${name}`).toBe(false);
    }
  });

  it('не оставляет следов GPS в байтах результата', async () => {
    const processed = await processImage(await photoWithGps());
    const bytes = processed.variants.full.buffer.toString('latin1');

    expect(bytes).not.toContain('iPhone');
    expect(bytes).not.toContain('GPS');
  });

  it('отклоняет файл, который не является изображением', async () => {
    const notAnImage = Buffer.from('%PDF-1.7 fake pdf content');
    await expect(processImage(notAnImage)).rejects.toBeInstanceOf(ImageError);
  });

  it('принимает мелкое изображение и не растягивает его', async () => {
    const tiny = await sharp({
      create: { width: 100, height: 140, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();

    const processed = await processImage(tiny);

    expect(processed.width).toBe(100);
    // Апскейла нет: замыленная картинка хуже маленькой.
    expect(processed.variants.full.width).toBe(100);
    expect(processed.variants.thumb.width).toBe(100);
  });

  it('отвергает «бомбу сжатия» — маленький файл с гигантским холстом', async () => {
    // 30000×30000 = 900 Мпикс, втрое выше лимита sharp, но в сжатом виде
    // это считаные килобайты.
    const bomb = await sharp({
      create: { width: 30000, height: 30000, channels: 3, background: '#000' },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(processImage(bomb)).rejects.toBeInstanceOf(ImageError);
  });

  it('готовит три размера и превью-заглушку', async () => {
    const processed = await processImage(await photoWithGps(1600, 2000));

    expect(processed.variants.thumb.width).toBe(320);
    expect(processed.variants.card.width).toBe(640);
    expect(processed.variants.full.width).toBe(1280);
    expect(processed.blurDataUrl.startsWith('data:image/webp;base64,')).toBe(true);
  });
});
