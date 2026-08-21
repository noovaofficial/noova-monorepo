#!/bin/sh
# Один дамп БД. Вызывается из backup-loop.sh или вручную/из cron на хосте.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/noova-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] дамп ${PGDATABASE} -> ${TARGET}"

# Пишем во временный файл и переименовываем в конце: если процесс упадёт
# посередине, в каталоге не останется битого дампа, который выглядит как валидный.
TMP="${TARGET}.partial"
pg_dump --format=plain --no-owner --no-acl --clean --if-exists | gzip -9 > "$TMP"
mv "$TMP" "$TARGET"

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "[backup] готово: ${TARGET} (${SIZE})"

# Ротация: удаляем дампы старше KEEP_DAYS.
find "$BACKUP_DIR" -name 'noova-*.sql.gz' -type f -mtime "+${KEEP_DAYS}" -print -delete
find "$BACKUP_DIR" -name '*.partial' -type f -mtime +1 -delete
