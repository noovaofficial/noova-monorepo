import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VIDEO_MAX_SECONDS, videoTargetSize } from '@noova/shared';
import sharp from 'sharp';
import { cornerWatermark } from '../photos/images.js';

/**
 * Обёртка над ffmpeg/ffprobe. Оба берутся из PATH: в образе API они стоят
 * пакетом `ffmpeg` (apps/api/Dockerfile), на машине разработчика — как
 * установлены.
 *
 * Зачем перекодировать, а не хранить как есть — те же причины, что у фото
 * (photos/images.ts): в файле с телефона лежат GPS-координаты места съёмки,
 * а формат и кодек задаёт клиент. После ffmpeg остаётся MP4 H.264 без
 * метаданных, который играет любой браузер, с тем же знаком в углу.
 */

export class VideoError extends Error {
  constructor(readonly reason: 'unreadable' | 'too_long' | 'unavailable') {
    super(reason);
    this.name = 'VideoError';
  }
}

/** Запас поверх лимита: контейнеры округляют длительность по-своему. */
const DURATION_TOLERANCE_SECONDS = 0.5;
const PROBE_TIMEOUT_MS = 20_000;
const TRANSCODE_TIMEOUT_MS = 5 * 60_000;

function run(
  bin: 'ffmpeg' | 'ffprobe',
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    // Зависший на битом файле процесс не должен держать очередь вечно.
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // Хвоста достаточно для лога; весь вывод ffmpeg — мегабайты прогресса.
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      // Бинарника нет в PATH — это не «плохой файл», а неготовое окружение.
      reject(
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? new VideoError('unavailable') : error,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export type VideoProbe = {
  /** Размер кадра, как его увидит зритель: с учётом поворота. */
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
};

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number | string }[];
  disposition?: { attached_pic?: number };
};

/**
 * Разбор вывода ffprobe. Чистая функция — проверяется без бинарника.
 *
 * Поворот важен: телефон пишет вертикальное видео как горизонтальный кадр
 * с пометкой «повернуть на 90°». ffmpeg при перекодировании поворачивает
 * сам, и размер результата нужно считать уже от повёрнутого кадра.
 */
export function parseProbe(json: string): VideoProbe {
  let data: { streams?: ProbeStream[]; format?: { duration?: string } };
  try {
    data = JSON.parse(json);
  } catch {
    throw new VideoError('unreadable');
  }
  const streams = data.streams ?? [];
  // Обложка альбома в аудиофайле — тоже «видеопоток», но не видео.
  const video = streams.find(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
  );
  if (!video?.width || !video.height) throw new VideoError('unreadable');

  const durationSeconds = Number(data.format?.duration ?? video.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new VideoError('unreadable');

  const rotation = Number(
    video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ??
      video.tags?.rotate ??
      0,
  );
  const sideways = Math.abs(rotation) % 180 === 90;
  return {
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    durationSeconds,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

/** Читает параметры файла. Не видео или длиннее лимита — `VideoError`. */
export async function probeVideo(path: string): Promise<VideoProbe> {
  const { code, stdout } = await run(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    PROBE_TIMEOUT_MS,
  );
  if (code !== 0) throw new VideoError('unreadable');
  const probe = parseProbe(stdout);
  if (probe.durationSeconds > VIDEO_MAX_SECONDS + DURATION_TOLERANCE_SECONDS) {
    throw new VideoError('too_long');
  }
  return probe;
}

export type TranscodedVideo = {
  videoPath: string;
  posterPath: string;
  width: number;
  height: number;
  durationMs: number;
};

/**
 * Перекодирует исходник в `video.mp4` и снимает кадр-постер `poster.webp`,
 * оба — в `workDir`. Вотермарка впекается в кадр, как у фото: модератор
 * проверяет ровно то, что увидит посетитель.
 */
export async function transcodeVideo(
  sourcePath: string,
  workDir: string,
  probe: VideoProbe,
): Promise<TranscodedVideo> {
  const size = videoTargetSize(probe.width, probe.height);

  // Знак — тот же SVG, что на фото, растром под итоговый размер кадра.
  const mark = cornerWatermark(size.width, size.height);
  const markPath = join(workDir, 'mark.png');
  await writeFile(markPath, await sharp(mark.input).png().toBuffer());

  const videoPath = join(workDir, 'video.mp4');
  const encode = await run(
    'ffmpeg',
    [
      '-y',
      '-i',
      sourcePath,
      '-i',
      markPath,
      '-filter_complex',
      `[0:v]scale=${size.width}:${size.height},setsar=1[base];[base][1:v]overlay=${mark.left}:${mark.top}[out]`,
      '-map',
      '[out]',
      // Звук — если есть; «?» не даёт упасть на немом ролике.
      '-map',
      '0:a:0?',
      // Лимит длительности — и здесь: проверка на загрузке верит контейнеру,
      // а он может врать.
      '-t',
      String(VIDEO_MAX_SECONDS),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-fpsmax',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      // Метаданные исходника (GPS, модель телефона, дата) наружу не идут.
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      // Индекс в начале файла: браузер начинает играть, не скачав всё.
      '-movflags',
      '+faststart',
      videoPath,
    ],
    TRANSCODE_TIMEOUT_MS,
  );
  if (encode.code !== 0) {
    throw new Error(`ffmpeg завершился с кодом ${encode.code}: ${encode.stderr.slice(-800)}`);
  }

  // Длительность и размер — по результату, а не по исходнику.
  const result = parseProbe(
    (
      await run(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath],
        PROBE_TIMEOUT_MS,
      )
    ).stdout,
  );

  // Постер — кадр из готового ролика (уже со знаком). Не самый первый:
  // ролики часто начинаются с чёрного или смазанного кадра.
  const framePath = join(workDir, 'frame.png');
  const frame = await run(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(Math.min(1, result.durationSeconds / 2)),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      framePath,
    ],
    PROBE_TIMEOUT_MS,
  );
  if (frame.code !== 0) {
    throw new Error(`ffmpeg не снял постер: ${frame.stderr.slice(-800)}`);
  }
  const posterPath = join(workDir, 'poster.webp');
  await writeFile(
    posterPath,
    await sharp(await readFile(framePath))
      .webp({ quality: 82 })
      .toBuffer(),
  );

  return {
    videoPath,
    posterPath,
    width: result.width,
    height: result.height,
    durationMs: Math.round(result.durationSeconds * 1000),
  };
}
