#!/usr/bin/env bash
#
# Забрать справочник с сервера в репозиторий (N-32).
#
#   make reference-pull SERVER=deploy@<IP>
#
# Города, услуги и районы заводятся в админке, то есть живут в базе сервера.
# Чтобы они пережили переустановку машины, их нужно вернуть в репозиторий —
# этим и занимается команда.
#
# Выгрузка внутри контейнера пишет файл в свою файловую систему
# (`/app/apps/api/prisma/reference-data.ts`), а не на хост: при следующем
# выпуске контейнер пересоздаётся, и файл пропадает вместе с ним. Поэтому
# забираем содержимое потоком, не полагаясь на то, что оно где-то полежит.
set -euo pipefail

SERVER="${1:-}"
DIR="${2:-noova}"
TARGET="apps/api/prisma/reference-data.json"
REMOTE_PATH="/app/apps/api/prisma/reference-data.json"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$SERVER" ] || fail "Укажите SERVER=deploy@<IP>"

say "Выгрузка на сервере"
ssh "$SERVER" "cd '$DIR' && docker compose exec -T api node dist/scripts/export-reference.js" \
  || fail "Выгрузка не отработала — смотрите вывод выше"

say "Забираю файл"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
ssh "$SERVER" "cd '$DIR' && docker compose exec -T api cat '$REMOTE_PATH'" > "$TMP"

# Проверяем, что приехал справочник, а не пустота и не сообщение об ошибке:
# перезапись рабочего файла мусором стоила бы дороже, чем неудачная попытка.
python3 -c "import json,sys; d=json.load(open('$TMP')); assert d['countries'] and d['cities'] and d['services']" 2>/dev/null \
  || fail "Получен не справочник — не перезаписываю $TARGET"

if [ -f "$TARGET" ] && cmp -s "$TMP" "$TARGET"; then
  printf '\033[32m✓ Справочник уже совпадает\033[0m — на сервере нет ничего нового.\n'
  exit 0
fi

count() { python3 -c "
import json,sys
d = json.load(open(sys.argv[1]))
print(f\"стран {len(d['countries'])}, городов {len(d['cities'])}, услуг {len(d['services'])}\")
" "$1"; }
BEFORE="$([ -f "$TARGET" ] && count "$TARGET" || echo 'файла не было')"
cp "$TMP" "$TARGET"
AFTER="$(count "$TARGET")"

printf '\033[32m✓ %s обновлён\033[0m\n  было:  %s\n  стало: %s\n' "$TARGET" "$BEFORE" "$AFTER"
printf '  Посмотреть: git diff -- %s\n' "$TARGET"
printf '  Закоммитить: без этого следующий выпуск вернёт прежний справочник.\n'
