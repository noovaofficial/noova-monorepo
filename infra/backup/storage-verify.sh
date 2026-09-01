#!/usr/bin/env bash
#
# Проверка одной копии на машине-хранилище — без Postgres и без Docker.
#
#   bash storage-verify.sh 20260830T032000Z
#
# Полная проверка (infra/backup/check.sh) разворачивает дамп в настоящую базу
# и потому требует Docker с Postgres. Хранилище — слабая машина, поэтому здесь
# всё считается потоком, за один проход по каждому файлу:
#
#   расшифровать -> разжать -> посчитать -> выбросить
#
# Ничего не пишется на диск, кроме списка имён из архива. Это важно и само по
# себе: закрытый ключ здесь лежит, но расшифрованных персональных данных на
# диске не остаётся даже во время проверки.
#
# Что ловится: неверное шифрование (ключ не подходит), обрыв и порча файла,
# оборванный на середине pg_dump, пропавшие фотографии, расхождение числа
# фотографий с числом строк в базе.
#
# Чего этим не поймать: дамп, который разжимается, но не разворачивается
# из-за ошибки в самом SQL. Такое даёт только восстановление в базу —
# `make backup-check` у вас на машине, раз в месяц.
set -euo pipefail

CONF="${NOOVA_PULL_CONF:-$HOME/noova-pull.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

DIR="${PULL_DEST:-$HOME/backups}"
KEY="${PULL_PRIVATE_KEY:-$HOME/backup-private.pem}"
STAMP="${1:-}"

ok()   { printf '  ✓ %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
fail() { printf '\033[31m  ✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$STAMP" ] || fail "Использование: storage-verify.sh <метка>"
[ -f "$KEY" ] || fail "Нет закрытого ключа $KEY — без него проверить копию нечем"

DUMP_ENC="$DIR/noova-${STAMP}.sql.gz.enc"
MEDIA_ENC="$DIR/noova-media-${STAMP}.tar.gz.enc"
[ -f "$DUMP_ENC" ] || fail "Нет дампа: $DUMP_ENC"
# Без архива сверять базу не с чем, а сверка здесь и есть главное.
[ -f "$MEDIA_ENC" ] || fail "Нет архива фотографий для метки $STAMP"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

decrypt() {
	openssl smime -decrypt -binary -inform DER -in "$1" -inkey "$KEY"
}

# --- база ------------------------------------------------------------------
# Один проход: считаем таблицы, строки Photo и Profile и ищем завершающую
# строку pg_dump. Строки данных в формате COPY заканчиваются одиночным «\.»;
# внутри данных такая строка появиться не может — pg_dump экранирует обратный
# слэш, поэтому граница блока определяется однозначно.
REPORT="$(decrypt "$DUMP_ENC" | gzip -dc | awk '
	/^CREATE TABLE /                    { tables++ }
	/^COPY .*"Photo" .*FROM stdin;/     { inph = 1; next }
	/^COPY .*"Profile" .*FROM stdin;/   { inpr = 1; next }
	inph && /^\\\.$/                    { inph = 0; next }
	inpr && /^\\\.$/                    { inpr = 0; next }
	inph                                { photos++ }
	inpr                                { profiles++ }
	/PostgreSQL database dump complete/ { complete = 1 }
	END { printf "%d %d %d %d\n", tables, photos, profiles, complete }
')" || fail "Дамп не расшифровался или повреждён. Тот ли ключ?"

read -r TABLES PHOTOS PROFILES COMPLETE <<< "$REPORT"

[ "$COMPLETE" = 1 ] || fail "Дамп оборван: нет завершающей строки pg_dump.
  Копия непригодна — восстановится лишь часть таблиц."
[ "$TABLES" -gt 0 ] || fail "В дампе нет ни одной таблицы"
ok "база: таблиц $TABLES, анкет $PROFILES, фото $PHOTOS"

# --- фотографии ------------------------------------------------------------
# MinIO хранит объект каталогом с именем объекта, а байты кладёт внутрь —
# в xl.meta для мелких, в part.N для крупных. Файлов *.webp в архиве нет и
# быть не должно; считаем каталоги. На диск попадает только список имён.
LIST="$TMP/list"
decrypt "$MEDIA_ENC" | tar tzf - > "$LIST" \
	|| fail "Архив фотографий не расшифровался или повреждён"

OBJECTS="$(grep -c '\.webp/$' "$LIST" || true)"
[ "$OBJECTS" -gt 0 ] || fail "В архиве нет ни одного объекта — копия фотографий непригодна"
MEDIA_PHOTOS="$(grep '\.webp/$' "$LIST" | sed 's|/[^/]*/$||' | sort -u | wc -l | tr -d ' ')"
ok "фотографии: объектов $OBJECTS, снимков $MEDIA_PHOTOS"

# --- сверка ----------------------------------------------------------------
if [ "$MEDIA_PHOTOS" -lt "$PHOTOS" ]; then
	# Строка в базе без файла в хранилище — битая анкета, и по одному лишь
	# дампу этого не видно.
	fail "Фотографий в архиве меньше, чем строк в базе: $MEDIA_PHOTOS против $PHOTOS.
  Не хватает $(( PHOTOS - MEDIA_PHOTOS )) — у этих анкет картинки не откроются."
elif [ "$MEDIA_PHOTOS" -gt "$PHOTOS" ]; then
	# Ожидаемо: снимок базы делается раньше архива, всё появившееся между
	# ними попадает в архив без строки в базе. Лишний файл безвреден.
	warn "в архиве на $(( MEDIA_PHOTOS - PHOTOS )) больше — снимок базы делался раньше, это норма"
fi

printf 'stamp=%s\ntables=%s\nprofiles=%s\nphotos=%s\nmedia_photos=%s\nchecked=%s\n' \
	"$STAMP" "$TABLES" "$PROFILES" "$PHOTOS" "$MEDIA_PHOTOS" \
	"$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DIR/noova-${STAMP}.ok"
rm -f "$DIR/noova-${STAMP}.bad"
ok "копия $STAMP пригодна"
