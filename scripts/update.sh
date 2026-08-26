#!/usr/bin/env bash
#
# Перезапуск стека из образов, которые уже лежат на сервере. Применяет правку
# `.env`, новый Caddyfile, изменения в compose. Образы не собирает и не везёт —
# для этого `make deploy`.
#
# Печатает, какой тег запускается и какие вообще есть: `up -d` поднимает то,
# что записано в `.env`, и после оборвавшегося выпуска это прежняя версия.
# Команда при этом отрабатывает успешно, и «обновление» выглядит как обновление,
# не будучи им.
set -euo pipefail

TAG="$(grep -E '^IMAGE_TAG=' .env | tail -1 | cut -d= -f2-)"
PREFIX="$(grep -E '^IMAGE_PREFIX=' .env | tail -1 | cut -d= -f2-)"
PREFIX="${PREFIX:-noova}"

printf '\033[36m▸ Запускается: %s:%s\033[0m\n' "$PREFIX" "$TAG"

NEWEST="$(docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' \
  | grep "^${PREFIX}/web:" | sort -k2 -r | head -1 | cut -d' ' -f1 | cut -d: -f2-)"

if [ -n "$NEWEST" ] && [ "$NEWEST" != "$TAG" ]; then
  printf '\033[33m! На сервере есть более свежий образ: %s\n' "$NEWEST"
  printf '  В .env указан %s — обновления из более нового выпуска не применятся.\n' "$TAG"
  printf '  Похоже, прошлый `make deploy` оборвался после переноса образов.\n'
  printf '  Переключиться: sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=%s/" .env && make update\033[0m\n\n' "$NEWEST"
fi

docker compose up -d --no-build
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
