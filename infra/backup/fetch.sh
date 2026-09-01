#!/usr/bin/env bash
#
# Забрать копию с сервера к себе. Запускается НА ВАШЕЙ машине.
#
#   ./infra/backup/fetch.sh deploy@<IP> ~/noova-backup
#
# Снимок делается в момент запроса и идёт потоком: на сервере он не
# сохраняется. Обычно копии забирает машина-хранилище по расписанию, а это —
# разовый способ получить копию себе, например перед рискованной миграцией.
set -euo pipefail

SERVER="${1:-}"
DIR="${2:-}"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$SERVER" ] || fail "Использование: fetch.sh deploy@<IP> <каталог>"
[ -n "$DIR" ] || fail "Укажите каталог, куда сложить копию"
mkdir -p "$DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$DIR/noova-${STAMP}.sql.gz.enc"
MEDIA="$DIR/noova-media-${STAMP}.tar.gz.enc"

# Пишем в .partial и переименовываем в конце: оборванная передача не должна
# оставить файл под именем готовой копии.
say "Снимаю базу"
if ! ssh "$SERVER" 'cd noova && bash infra/backup/stream.sh db' > "$DUMP.partial"; then
	rm -f "$DUMP.partial"; fail "Снимок базы не удался"
fi
mv "$DUMP.partial" "$DUMP"

# Строго ПОСЛЕ базы: лишний файл в архиве безвреден, отсутствующий — нет.
say "Снимаю фотографии"
if ! ssh "$SERVER" 'cd noova && bash infra/backup/stream.sh media' > "$MEDIA.partial"; then
	rm -f "$MEDIA.partial" "$DUMP"; fail "Снимок фотографий не удался"
fi
mv "$MEDIA.partial" "$MEDIA"

printf '\n\033[32mГотово:\033[0m\n'
ls -lh "$DUMP" "$MEDIA" | awk '{printf "  %s  %s\n", $5, $9}'
printf '\nПроверить: make backup-check DIR=%s STAMP=%s\n' "$DIR" "$STAMP"
