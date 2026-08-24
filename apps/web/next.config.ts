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
    formats: ['image/avif', 'image/webp'],
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
};

export default withNextIntl(nextConfig);
