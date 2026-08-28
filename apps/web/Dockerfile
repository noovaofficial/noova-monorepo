# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Без CI=true pnpm при переустановке без dev-зависимостей спрашивает
# подтверждение на очистку node_modules, а в сборке терминала нет —
# шаг падает.
ENV CI=true
RUN corepack enable
WORKDIR /app

FROM base AS deps
# tsconfig.base.json нужен обоим приложениям: их tsconfig наследуется от него,
# и без файла падает и `prisma generate`, и сборка.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @noova/web... --filter @noova/shared

FROM deps AS build
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# Публичные переменные вшиваются в бандл на этапе сборки, а не читаются в рантайме.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
# Хост хранилища: из него next.config.ts строит images.remotePatterns.
# Нужен именно на сборке — в рантайме этот список уже не меняется.
ARG NEXT_PUBLIC_MEDIA_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @noova/web build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 -G nodejs noova

# output: 'standalone' кладёт в .next/standalone минимальный сервер
# со всеми нужными зависимостями — копировать node_modules целиком не нужно.
COPY --from=build --chown=noova:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=noova:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=noova:nodejs /app/apps/web/public ./apps/web/public

# Каталог кэша заводим здесь, а не оставляем docker: под него подключён
# именованный том, и том наследует владельца каталога из образа. Без этой
# строки каталога в образе нет, том создаётся от root, а сервер работает
# под noova — и кэш молча не пишется.
RUN mkdir -p /app/apps/web/.next/cache && chown -R noova:nodejs /app/apps/web/.next

USER noova
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
