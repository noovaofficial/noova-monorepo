#!/usr/bin/env bash
#
# Восстановление базы из дампа. Разрушительная операция: содержимое текущей
# базы заменяется дампом.
#
#   ./infra/backup/restore.sh ~/noova-backup/noova-<stamp>.sql.gz
#
# Запускается НА ХОСТЕ, рядом с compose-файлом, и подаёт дамп в psql через
# stdin. Раньше скрипт жил внутри контейнера `backup` и ждал файл в /backups —
# но копий на сервере больше нет, монтировать их неоткуда, да и класть дамп
# на диск сервера ради восстановления незачем.
set -euo pipefail

DUMP="${1:-}"
COMPOSE="${COMPOSE:-docker compose}"

fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$DUMP" ] || fail "Использование: restore.sh <дамп.sql.gz>"
[ -f "$DUMP" ] || fail "Файл не найден: $DUMP"
case "$DUMP" in
	*.enc) fail "Файл ещё зашифрован. Сначала: make backup-open FILE=$DUMP KEY=…" ;;
esac
gzip -t "$DUMP" 2>/dev/null || fail "Файл повреждён или не gzip: $DUMP"

printf 'ВНИМАНИЕ: содержимое базы будет заменено дампом %s\n' "$DUMP"
printf 'Продолжить? [yes/NO] '
read -r ANSWER
[ "$ANSWER" = "yes" ] || { echo "Отменено."; exit 1; }

# Пользователя и базу берём из окружения контейнера: пароли не должны
# появляться в командной строке и в истории оболочки.
gunzip -c "$DUMP" | $COMPOSE exec -T postgres sh -c \
	'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --set ON_ERROR_STOP=on' >/dev/null

printf '\033[32m✓ база восстановлена\033[0m\n'
printf 'Фотографии восстанавливаются отдельно: make restore-media ARCHIVE=…\n'
