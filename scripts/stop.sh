#!/usr/bin/env bash
# Останавливает процессы разработки только этого репозитория.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

by_path=$(ps -eo pid,command \
  | grep -F "$ROOT" \
  | grep -E 'tsx|next|pnpm --filter @noova' \
  | grep -v grep \
  | grep -v 'Helper' \
  | awk '{print $1}' || true)

# next-server не содержит путь к проекту в командной строке — ищем и по портам.
by_port=$(lsof -ti:3000 -ti:4000 2>/dev/null || true)
pids=$(printf '%s\n%s\n' "$by_path" "$by_port" | grep -E '^[0-9]+$' | sort -u || true)

if [ -z "$pids" ]; then
  echo "Нечего останавливать."
  exit 0
fi

echo "$pids" | xargs kill -9 2>/dev/null || true
echo "Остановлено: $(echo "$pids" | wc -l | tr -d ' ')"
