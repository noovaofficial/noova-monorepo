import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Хост объектного хранилища. В разработке это MinIO на localhost:9000,
 * в проде — публичный домен из MEDIA_BASE_URL за тем же Caddy.
 */
const mediaUrl = new URL(process.env.NEXT_PUBLIC_MEDIA_URL ?? 'http://localhost:9000');

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // standalone-вывод — минимальный образ без node_modules целиком.
  output: 'standalone',
  // В монорепо трассировку файлов нужно вести от корня, иначе в standalone
  // не попадают зависимости из корневого node_modules (с pnpm это ломает запуск).
  outputFileTracingRoot: path.join(currentDir, '../../'),
  // Трассировка затягивает из @swc/helpers только cjs-сборку, а require-hook
  // внутри next обращается к esm-варианту. Включаем пакет целиком.
  outputFileTracingIncludes: {
    '/**': ['../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**'],
  },
  // Исходники воркспейс-пакета компилируются вместе с приложением.
  transpilePackages: ['@noova/shared'],
  poweredByHeader: false,
  // Next генерирует собственные AGENTS.md/CLAUDE.md — проектная документация
  // живёт в README.md и documentation/arch/architecture.md, дубли не нужны.
  agentRules: false,
  images: {
    // Только webp: наши фото и так уже webp (обработаны sharp при загрузке,
    // apps/api/src/modules/photos/images.ts), и Next транскодирует их в avif
    // на лету при каждом первом запросе конкретного размера — это самое
    // дорогое место в оптимизаторе по CPU, а выигрыш в весе против уже
    // сжатого webp небольшой. На проде это стабильно самый нагруженный по CPU
    // контейнер (web, докер-статистика), выше api.
    formats: ['image/webp'],
    // Next разрешает только перечисленные quality; 75 — значение по умолчанию.
    qualities: [75, 100],
    // Список сокращён под реальные `sizes` в приложении (84px/88px — миниатюры,
    // 240px — плитка каталога, 600px — карточка анкеты, 100vw — лайтбокс) —
    // вместо стандартных 8+8 комбинаций Next считает вдвое меньше вариантов
    // на каждое уникальное фото. Верх — 1920: ровно потолок исходника
    // (`VARIANT_WIDTHS.full`), выше своих пикселей у Next всё равно нет.
    imageSizes: [96, 192, 256, 384, 480],
    deviceSizes: [640, 750, 960, 1080, 1280, 1600, 1920],
    // Наши фото неизменяемы (ключ хранилища содержит id фото, а объект в
    // MinIO отдаётся с Cache-Control: immutable — apps/api/.../storage.ts).
    // Next по умолчанию перепроверяет и пересчитывает оптимизированную копию
    // каждую минуту; для неизменного источника это чистые лишние перекодирования.
    // Год — тот же срок, что уже стоит на самом объекте в хранилище.
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: mediaUrl.protocol.replace(':', '') as 'http' | 'https',
        hostname: mediaUrl.hostname,
        ...(mediaUrl.port ? { port: mediaUrl.port } : {}),
      },
    ],
    // Next блокирует оптимизацию картинок с приватных адресов — это защита
    // от SSRF: иначе через параметр url можно дотянуться до сервисов во
    // внутренней сети. В разработке хранилище живёт на localhost, поэтому
    // послабление нужно, но включается ТОЛЬКО вне прода.
    dangerouslyAllowLocalIP: isDev,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Каталог 18+: запрещаем индексацию превью-контента сторонними фреймами.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
  // Поддомен агентства (N-38, `{slug}.{домен}`) маршрутизируется в
  // src/proxy.ts, не здесь: он должен сработать раньше next-intl —
  // тот сам редиректит `/` на `/{locale}` до того, как применился бы
  // рерайт из этого файла, и переписанный им путь коверкался бы повторно.
};

export default withNextIntl(nextConfig);
