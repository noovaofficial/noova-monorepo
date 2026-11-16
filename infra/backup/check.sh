#!/usr/bin/env bash
#
# Проверка резервной копии целиком: расшифровать, развернуть базу, сверить
# фотографии.
#
#   make backup-check                                  # свежая пара в ~/noova-backup
#   make backup-check DIR=~/noova-backup STAMP=20260829T145907Z
#
# Зачем отдельная команда поверх backup-open и backup-verify.
#
# 1. Сверка базы с хранилищем. По отдельности они ничего не говорят: дамп
#    разворачивается, архив распаковывается, а фотографий у половины анкет
#    нет. Битую анкету видно только в сравнении.
# 2. Расшифрованное не остаётся на диске. `backup-open` кладёт открытый дамп
#    рядом с зашифрованным и оставляет его там навсегда — а это особая
#    категория данных на ноутбуке. Здесь всё живёт во временном каталоге и
#    удаляется на выходе, в том числе при ошибке.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${DIR:-$HOME/noova-backup}"
KEY="${KEY:-$DIR/backup-private.pem}"
STAMP="${STAMP:-}"

say() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -d "$DIR" ] || fail "Нет каталога $DIR"
[ -f "$KEY" ] || fail "Нет закрытого ключа $KEY.
  Он создаётся вместе с открытым: ./infra/backup/make-key.sh $DIR"

# Дамп разворачивается в контейнер стенда — без него проверять нечем.
docker compose -f "$ROOT/docker-compose.dev.yml" ps --status running --services 2>/dev/null \
  | grep -qx postgres || fail "Не поднят стенд. Сначала: make infra-up"

# ---------------------------------------------------------------------------
say "Копия"
# ---------------------------------------------------------------------------
if [ -z "$STAMP" ]; then
  NEWEST="$(ls -t "$DIR"/noova-*.sql.gz.enc 2>/dev/null | head -1)" \
    || fail "В $DIR нет зашифрованных дампов"
  [ -n "$NEWEST" ] || fail "В $DIR нет зашифрованных дампов (noova-*.sql.gz.enc)"
  STAMP="$(basename "$NEWEST" | sed 's/^noova-//; s/\.sql\.gz\.enc$//')"
fi

DUMP_ENC="$DIR/noova-${STAMP}.sql.gz.enc"
MEDIA_ENC="$DIR/noova-media-${STAMP}.tar.gz.enc"
[ -f "$DUMP_ENC" ] || fail "Нет дампа: $DUMP_ENC"
# Пара обязательна: сверять базу не с чем, а именно сверка здесь и главное.
[ -f "$MEDIA_ENC" ] || fail "Нет архива фотографий: $MEDIA_ENC
  Снимок делался без него? Пересоздайте: make backup-fetch SERVER=… DIR=$DIR"
ok "$STAMP"

# ---------------------------------------------------------------------------
# Всё расшифрованное — во временный каталог, и он удаляется в любом случае.
# ---------------------------------------------------------------------------
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

say "Расшифровка"
DUMP="$TMP/noova-${STAMP}.sql.gz"
MEDIA="$TMP/noova-media-${STAMP}.tar.gz"
openssl smime -decrypt -binary -inform DER -in "$DUMP_ENC" -inkey "$KEY" -out "$DUMP" \
  || fail "Дамп не расшифровался. Тот ли ключ?"
openssl smime -decrypt -binary -inform DER -in "$MEDIA_ENC" -inkey "$KEY" -out "$MEDIA" \
  || fail "Архив фотографий не расшифровался"
ok "во временный каталог, будет удалён на выходе"

# ---------------------------------------------------------------------------
say "База"
# ---------------------------------------------------------------------------
REPORT="$TMP/report"
REPORT_FILE="$REPORT" "$ROOT/infra/backup/verify.sh" "$DUMP"
# shellcheck source=/dev/null
[ -f "$REPORT" ] && . "$REPORT" || fail "verify.sh не отдал отчёт"

# ---------------------------------------------------------------------------
say "Фотографии"
# ---------------------------------------------------------------------------
# MinIO хранит объект каталогом с именем объекта, а байты кладёт внутрь —
# в xl.meta для мелких, в part.N для крупных. Файлов *.webp в архиве нет и
# быть не должно; считаем каталоги.
LIST="$TMP/list"
tar tzf "$MEDIA" > "$LIST" || fail "Архив фотографий не читается"

#
# Копия, снятая через S3-API (MEDIA_BACKUP=s3), устроена иначе: в ней лежат
# сами файлы. Отличаем по наличию каталогов `*.webp/` и дальше считаем по
# одному списку путей без хвостовой косой черты.
if grep -q '\.webp/$' "$LIST"; then
  FORMAT="том MinIO"
  WEBP="$(grep '\.webp/$' "$LIST" | sed 's|/$||')"
else
  FORMAT="S3-API"
  WEBP="$(grep '\.webp$' "$LIST" || true)"
fi
printf '  формат:     %s\n' "$FORMAT"

OBJECTS="$(printf '%s\n' "$WEBP" | grep -c . || true)"
# Фотография — это каталог с её размерами. Постер видео и снимки документов
# тоже webp, но строк в таблице Photo у них нет: считать их фотографиями
# значило бы завысить число и не заметить настоящую недостачу.
PHOTO_FILES="$(printf '%s\n' "$WEBP" | grep -vE '/video-[^/]*/|(^|/)verification/' || true)"
MEDIA_PHOTOS="$(printf '%s\n' "$PHOTO_FILES" | grep . | sed 's|/[^/]*$||' | sort -u | wc -l | tr -d ' ')"
SIZES="$(printf '%s\n' "$PHOTO_FILES" | grep . | sed 's|.*/||' | sort -u | tr '\n' ' ')"

printf '  объектов:   %s\n' "$OBJECTS"
printf '  фотографий: %s\n' "$MEDIA_PHOTOS"
printf '  размеры:    %s\n' "${SIZES:-—}"

[ "$OBJECTS" -gt 0 ] || fail "В архиве нет ни одного объекта — копия фотографий непригодна"

# ---------------------------------------------------------------------------
say "Сверка"
# ---------------------------------------------------------------------------
printf '  в базе:  %s фото (живых; удалённых %s)\n' "${photos:-?}" "${deleted_photos:-0}"
printf '  в архиве: %s\n\n' "$MEDIA_PHOTOS"

if [ "${photos:-?}" = '?' ]; then
  warn "в дампе нет таблицы Photo — сверить не с чем"
elif [ "$MEDIA_PHOTOS" -lt "$photos" ]; then
  # Строка в базе без файла в хранилище — битая анкета. Это настоящая потеря,
  # и из дампа её не видно.
  fail "Фотографий в архиве меньше, чем строк в базе: $MEDIA_PHOTOS против $photos.
  Не хватает $(( photos - MEDIA_PHOTOS )) — у этих анкет картинки не откроются."
elif [ "$MEDIA_PHOTOS" -gt "$photos" ]; then
  # Ожидаемо: снимок базы делается раньше архива, и всё, что появилось между
  # ними, попадает в архив без строки в базе. Лишний файл безвреден.
  warn "в архиве на $(( MEDIA_PHOTOS - photos )) больше — снимок базы делался раньше, это норма"
fi

printf '\033[32m✓ Копия %s пригодна: база разворачивается, фотографии на месте\033[0m\n' "$STAMP"
printf '  расшифрованные файлы удалены\n'
