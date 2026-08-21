#!/bin/sh
# Простейший планировщик: цикл со сном вместо cron.
# Причина — в контейнере cron требует отдельного демона и своей доставки
# переменных окружения; цикл делает то же самое и логируется в docker logs.
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

echo "[backup] запуск, интервал ${INTERVAL}s, хранение ${BACKUP_KEEP_DAYS:-14} дней"

# Первый дамп — сразу, чтобы не ждать сутки до проверки, что бэкапы вообще работают.
while true; do
	if ! /bin/sh /scripts/backup.sh; then
		echo "[backup] ОШИБКА дампа, повтор через ${INTERVAL}s" >&2
	fi
	sleep "$INTERVAL"
done
