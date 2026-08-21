#!/usr/bin/env bash
#
# Запуск среды разработки.
#
# Существует по двум причинам.
#
# 1. Накопление процессов. `next dev` и `tsx watch` держат много файловых
#    наблюдателей. Если запускать их фоном и забывать останавливать, за день
#    набегает десяток живых процессов, и система упирается в kern.maxfiles —
#    очередной запуск падает с «EMFILE: too many open files». Скрипт сначала
#    гасит прежние процессы этого проекта.
#
# 2. Чужое не трогаем. Гасятся только процессы, чей путь ведёт в этот
#    репозиторий: другие проекты и расширения редактора продолжают работать.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

stop_previous() {
  local by_path by_port pids

  # По пути к репозиторию: ловит pnpm, tsx и дочерние процессы.
  by_path=$(ps -eo pid,command \
    | grep -F "$ROOT" \
    | grep -E 'tsx|next|pnpm --filter @noova' \
    | grep -v grep \
    | grep -v 'Helper' \
    | awk '{print $1}' || true)

  # По портам: у `next-server` в командной строке нет пути к проекту, и по
  # одному только пути он не находится — а порт держит именно он.
  by_port=$(lsof -ti:3000 -ti:4000 2>/dev/null || true)

  pids=$(printf '%s\n%s\n' "$by_path" "$by_port" | grep -E '^[0-9]+$' | sort -u || true)

  if [ -n "$pids" ]; then
    echo "Останавливаю прежние процессы: $(echo "$pids" | wc -l | tr -d ' ')"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    # Порт освобождается не мгновенно.
    sleep 2
  fi
}

stop_previous

# Запас дескрипторов на файловых наблюдателей: жёсткий лимит на macOS обычно
# unlimited, а мягкий по умолчанию низкий.
ulimit -n 65536 2>/dev/null || true

echo "Инфраструктура…"
docker compose -f "$ROOT/docker-compose.dev.yml" up -d >/dev/null

cd "$ROOT"
exec pnpm run --parallel --filter "./apps/*" dev
