#!/usr/bin/env bash
#
# Восстановление фотографий из снимка в том MinIO (N-29).
# Разрушительная операция: содержимое тома заменяется архивом.
#
#   ./infra/backup/restore-media.sh noova-media-<stamp>.tar.gz [имя_тома]
set -euo pipefail

ARCHIVE="${1:-}"
VOLUME="${2:-noova_minio_data}"

[ -n "$ARCHIVE" ] || { echo "Использование: restore-media.sh <архив.tar.gz> [том]" >&2; exit 1; }
[ -f "$ARCHIVE" ] || { echo "Файл не найден: $ARCHIVE" >&2; exit 1; }
docker volume inspect "$VOLUME" >/dev/null 2>&1 || { echo "Тома $VOLUME нет" >&2; exit 1; }

echo "ВНИМАНИЕ: содержимое тома ${VOLUME} будет заменено архивом ${ARCHIVE}."
printf 'Продолжить? [yes/NO] '
read -r answer
[ "$answer" = "yes" ] || { echo "Отменено."; exit 1; }

# MinIO держит файлы открытыми — распаковка под работающим контейнером
# оставила бы часть старых объектов и часть новых.
echo "[restore-media] останавливаю minio"
docker compose stop minio >/dev/null 2>&1 || true

docker run --rm -v "$VOLUME":/data -v "$(cd "$(dirname "$ARCHIVE")" && pwd)":/src:ro \
  postgres:17-alpine sh -c "rm -rf /data/* /data/..?* 2>/dev/null; tar xzf /src/$(basename "$ARCHIVE") -C /data"

echo "[restore-media] поднимаю minio"
docker compose start minio >/dev/null 2>&1 || true
echo "[restore-media] готово"
