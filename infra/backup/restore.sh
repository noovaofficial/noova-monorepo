#!/bin/sh
# Восстановление из дампа. Операция разрушительная: перезаписывает текущую БД.
#
#   docker compose exec -T postgres sh /scripts/restore.sh /backups/noova-<stamp>.sql.gz
set -eu

DUMP="${1:-}"

if [ -z "$DUMP" ]; then
	echo "Использование: restore.sh <путь-к-дампу.sql.gz>" >&2
	exit 1
fi

if [ ! -f "$DUMP" ]; then
	echo "Файл не найден: $DUMP" >&2
	exit 1
fi

echo "ВНИМАНИЕ: содержимое базы ${PGDATABASE} будет заменено дампом ${DUMP}."
printf 'Продолжить? [yes/NO] '
read -r answer
[ "$answer" = "yes" ] || { echo "Отменено."; exit 1; }

gunzip -c "$DUMP" | psql --set ON_ERROR_STOP=on
echo "[restore] готово"
