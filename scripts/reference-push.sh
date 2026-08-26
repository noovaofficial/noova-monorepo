#!/usr/bin/env bash
#
# Отправить справочник из репозитория на сервер и накатить (N-32).
#
#   make reference-push SERVER=deploy@<IP>
#
# Нужна, когда справочник правился на стенде и его надо перенести на прод без
# полного выпуска. Данные читаются в рантайме (см. src/reference-data.ts),
# поэтому достаточно положить файл рядом с контейнером и пересеять.
#
# Важно: файл кладётся ВНУТРЬ контейнера, а тот пересоздаётся при следующем
# выпуске. Записи в базе останутся, но сам файл вернётся к версии из образа —
# поэтому изменения всё равно нужно закоммитить.
set -euo pipefail

SERVER="${1:-}"
DIR="${2:-noova}"
SOURCE="apps/api/prisma/reference-data.json"
REMOTE_PATH="/app/apps/api/prisma/reference-data.json"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$SERVER" ] || fail "Укажите SERVER=deploy@<IP>"
[ -f "$SOURCE" ] || fail "Нет $SOURCE"
python3 -c "import json,sys; json.load(open('$SOURCE'))" 2>/dev/null \
  || fail "$SOURCE — не валидный JSON, на сервер не отправляю"

COUNTS="$(python3 - "$SOURCE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"стран {len(d['countries'])}, городов {len(d['cities'])}, "
      f"районов {sum(len(c['districts']) for c in d['cities'])}, услуг {len(d['services'])}")
PY
)"
say "Отправляю: $COUNTS"

# Пишем во временный файл и переносим на месте: оборванная передача не должна
# оставить контейнер с половиной справочника.
ssh "$SERVER" "cd '$DIR' && docker compose exec -T api sh -c 'cat > ${REMOTE_PATH}.partial'" < "$SOURCE"
ssh "$SERVER" "cd '$DIR' && docker compose exec -T api sh -c 'mv ${REMOTE_PATH}.partial ${REMOTE_PATH}'"

# Старый образ несёт справочник внутри бандла: до перехода на чтение в
# рантайме отправка файла ничего не меняла, а сид отчитывался прежними
# числами — выглядело как успешный накат, которым не был.
say "Проверяю, что образ читает файл"
if ! ssh "$SERVER" "cd '$DIR' && docker compose exec -T api grep -q 'reference-data.json' dist/scripts/seed-reference.js"; then
  fail "Образ на сервере собран до перехода на чтение справочника в рантайме.
  Он использует данные, вшитые в бандл, и присланный файл проигнорирует.
  Сначала: make deploy SERVER=$SERVER"
fi

say "Накатываю"
ssh "$SERVER" "cd '$DIR' && docker compose exec -T api node dist/scripts/seed-reference.js"

printf '\n\033[32m✓ Справочник на сервере обновлён.\033[0m\n'
printf '  Закоммитьте %s — иначе следующий выпуск вернёт версию из образа.\n' "$SOURCE"
