import { videoTargetSize } from '@noova/shared';
import { describe, expect, it } from 'vitest';
import { parseProbe, VideoError } from './ffmpeg';

const probe = (streams: object[], duration = '12.5') =>
  JSON.stringify({ streams, format: { duration } });

describe('разбор ffprobe', () => {
  it('обычный ролик: размер, длительность, звук', () => {
    const result = parseProbe(
      probe([{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }]),
    );
    expect(result).toEqual({ width: 1920, height: 1080, durationSeconds: 12.5, hasAudio: true });
  });

  it('вертикальное видео с телефона: кадр горизонтальный, но с пометкой поворота', () => {
    const viaSideData = parseProbe(
      probe([
        { codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] },
      ]),
    );
    expect([viaSideData.width, viaSideData.height]).toEqual([1080, 1920]);

    const viaTag = parseProbe(
      probe([{ codec_type: 'video', width: 1920, height: 1080, tags: { rotate: '90' } }]),
    );
    expect([viaTag.width, viaTag.height]).toEqual([1080, 1920]);
  });

  it('поворот на 180° стороны не меняет', () => {
    const result = parseProbe(
      probe([
        { codec_type: 'video', width: 1280, height: 720, side_data_list: [{ rotation: 180 }] },
      ]),
    );
    expect([result.width, result.height]).toEqual([1280, 720]);
  });

  it('аудиофайл с обложкой — не видео', () => {
    const json = probe([
      { codec_type: 'audio' },
      { codec_type: 'video', width: 500, height: 500, disposition: { attached_pic: 1 } },
    ]);
    expect(() => parseProbe(json)).toThrow(VideoError);
  });

  it('мусор вместо вывода и файл без длительности отвергаются', () => {
    expect(() => parseProbe('not json')).toThrow(VideoError);
    expect(() =>
      parseProbe(JSON.stringify({ streams: [{ codec_type: 'video', width: 10, height: 10 }] })),
    ).toThrow(VideoError);
  });
});

describe('размер кадра после перекодирования', () => {
  it('горизонтальное 4K вписывается в 1280×720', () => {
    expect(videoTargetSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
  });

  it('вертикальное вписывается в 720×1280', () => {
    expect(videoTargetSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it('мелкое не увеличивается', () => {
    expect(videoTargetSize(640, 360)).toEqual({ width: 640, height: 360 });
  });

  it('стороны всегда чётные — иначе H.264 кадр не примет', () => {
    const size = videoTargetSize(853, 481);
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
  });
});
