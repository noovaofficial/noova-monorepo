# syntax=docker/dockerfile:1.7
# Многостадийная сборка: в финальный образ попадают только прод-зависимости
# и собранный бандл, без исходников и тулчейна.
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
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @noova/api... --filter @noova/shared

FROM deps AS build
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# `prisma generate` читает prisma.config.ts, а тот требует DATABASE_URL —
# хотя к базе не подключается: генерируется клиент по схеме. На шаге сборки
# базы нет и быть не может, поэтому подставляем заглушку прямо в команду.
# В образ она не попадает: строка живёт только внутри этого RUN, а рабочее
# значение приходит из окружения контейнера.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @noova/api db:generate
RUN pnpm --filter @noova/api build
# Пересобираем дерево зависимостей без dev-пакетов.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @noova/api... --filter @noova/shared

FROM base AS runner
ENV NODE_ENV=production
# Прод-процесс не должен ходить под root.
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 -G nodejs noova

COPY --from=build --chown=noova:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=noova:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=noova:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=noova:nodejs /app/apps/api/package.json ./apps/api/
# Prisma 7 держит строку подключения не в schema.prisma, а здесь. Без файла
# `prisma migrate deploy` в контейнере migrate падает с «datasource.url
# property is required» — при том что сборка проходит: на её стадии
# скопировано всё дерево apps/api.
COPY --from=build --chown=noova:nodejs /app/apps/api/prisma.config.ts ./apps/api/
COPY --from=build --chown=noova:nodejs /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=noova:nodejs /app/apps/api/src/generated ./apps/api/src/generated

USER noova
WORKDIR /app/apps/api
EXPOSE 4000

# tini не нужен: node 22 сам корректно обрабатывает SIGTERM, а graceful
# shutdown реализован в server.ts.
CMD ["node", "dist/server.js"]
