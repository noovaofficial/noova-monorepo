#!/usr/bin/env bash
#
# Полный снимок: база + фотографии, зашифрованные до выхода за пределы
# машины (N-29). Запускается НА СЕРВЕРЕ, из каталога стека.
#
#   ssh deploy@<IP> 'cd noova && bash -s' < infra/backup/snapshot.sh
#
# Шифрование делает хост, а не контейнер `backup`: в postgres:17-alpine нет
# ни openssl, ни age, ни gpg, а ставить их на старте контейнера значит
# поставить бэкапы в зависимость от сети в момент запуска.
set -euo pipefail

DIR="${NOOVA_DIR:-$HOME/noova}"
OUT="$DIR/backups"
KEY="${BACKUP_PUBLIC_KEY:-$DIR/backup-public.pem}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

cd "$DIR" || fail "Нет каталога $DIR"
[ -f "$KEY" ] || fail "Нет открытого ключа $KEY.
  Создайте пару у себя: ./infra/backup/make-key.sh ~/noova-backup
  и привезите открытую часть: scp backup-public.pem deploy@<IP>:noova/"

mkdir -p "$OUT"

# --- база ------------------------------------------------------------------
say "Дамп базы"
docker compose exec -T backup /bin/sh /scripts/backup.sh
DUMP="$(ls -t "$OUT"/noova-*.sql.gz 2>/dev/null | head -1)"
[ -n "$DUMP" ] || fail "Дамп не появился в $OUT"

# --- фотографии ------------------------------------------------------------
# Строго ПОСЛЕ дампа: лишний файл в архиве безвреден, отсутствующий — нет.
# Снимок между дампом и архивом добавит файл, на который в базе нет строки;
# обратный порядок дал бы строку без файла, то есть битую анкету.
say "Снимок фотографий"
VOLUME="$(docker compose config --format json 2>/dev/null \
  | sed -n 's/.*"\([a-z0-9_-]*minio_data\)".*/\1/p' | head -1)"
VOLUME="${VOLUME:-noova_minio_data}"
docker volume inspect "$VOLUME" >/dev/null 2>&1 || fail "Тома $VOLUME нет"

MEDIA="$OUT/noova-media-${STAMP}.tar.gz"
# Образ уже есть на машине — тот же, что у контейнера backup: лишнего не тянем.
docker run --rm -v "$VOLUME":/data:ro -v "$OUT":/out postgres:17-alpine \
  tar czf "/out/$(basename "$MEDIA")" -C /data .
[ -s "$MEDIA" ] || fail "Архив фотографий пуст"

# --- шифрование ------------------------------------------------------------
say "Шифрование"
for FILE in "$DUMP" "$MEDIA"; do
  openssl smime -encrypt -binary -aes-256-cbc -in "$FILE" -outform DER \
    -out "${FILE}.enc" "$KEY"
  # Открытый файл на сервере не оставляем: смысл шифрования в том, что
  # копия непригодна для чтения даже там, где она лежит.
  rm -f "$FILE"
done

printf '\n\033[32mСнимок готов:\033[0m\n'
ls -lh "${DUMP}.enc" "${MEDIA}.enc" | awk '{printf "  %s  %s\n", $5, $9}'
printf '\nЗабрать: make backup-fetch SERVER=deploy@<IP>\n'
