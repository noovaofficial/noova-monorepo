#!/usr/bin/env bash
#
# Забрать свежие копии с прод-сервера. Запускается ПО КРОНУ НА ХРАНИЛИЩЕ,
# настраивает его storage-setup.sh.
#
# Копии уже зашифрованы на проде открытым ключом (N-29), закрытого здесь нет
# и быть не должно: хранилище умеет только принимать и хранить, читать копии
# можно лишь там, где лежит закрытая часть.
set -euo pipefail

CONF="${NOOVA_PULL_CONF:-$HOME/noova-pull.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

FROM="${PULL_FROM:-}"
KEY="${PULL_KEY:-$HOME/.ssh/noova-pull}"
DEST="${PULL_DEST:-$HOME/backups}"
KEEP="${PULL_KEEP_DAYS:-30}"
FRESH="${PULL_MIN_FRESH_HOURS:-26}"
PING="${PULL_PING_URL:-}"
LOG="${PULL_LOG:-$HOME/noova-pull.log}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }
fail() { log "ОШИБКА: $1" >&2; exit 1; }

# Журнал обрезаем на месте (cat > file), а не через mv: крон держит его
# открытым на дозапись, и подмена inode увела бы весь вывод этого запуска
# в удалённый файл.
if [ -f "$LOG" ] && [ "$(stat -c '%s' "$LOG")" -gt 1048576 ]; then
	KEEP_TAIL="$(tail -n 500 "$LOG")"
	printf '%s\n' "$KEEP_TAIL" > "$LOG"
fi

[ -n "$FROM" ] || fail "не задан PULL_FROM — проверьте $CONF"
[ -f "$KEY" ] || fail "нет ключа $KEY"
mkdir -p "$DEST"

SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15
     -o StrictHostKeyChecking=yes "$FROM")

LIST="$("${SSH[@]}" list)" || fail "не отвечает $FROM (или ключ не принят)"
# Пустой список — это не «всё в порядке, качать нечего»: значит, снимки на
# проде перестали делаться, и молчать об этом нельзя.
[ -n "$LIST" ] || fail "на $FROM нет ни одной копии — снимок не делается?"

NEW=0
while read -r SIZE NAME; do
	[ -n "${NAME:-}" ] || continue
	TARGET="$DEST/$NAME"
	# Снимки неизменяемы, поэтому совпадения имени и размера достаточно,
	# чтобы не качать одно и то же каждую ночь.
	if [ -f "$TARGET" ] && [ "$(stat -c '%s' "$TARGET")" = "$SIZE" ]; then
		continue
	fi
	log "качаю $NAME ($SIZE Б)"
	TMP="$TARGET.partial"
	"${SSH[@]}" "fetch $NAME" > "$TMP" || { rm -f "$TMP"; fail "обрыв на $NAME"; }
	GOT="$(stat -c '%s' "$TMP")"
	# Обрыв ssh не всегда даёт ненулевой код возврата, а недокачанный файл
	# под правильным именем выглядит как готовая копия. Сверяем размер.
	[ "$GOT" = "$SIZE" ] || { rm -f "$TMP"; fail "$NAME: пришло $GOT Б вместо $SIZE"; }
	mv "$TMP" "$TARGET"
	NEW=$((NEW + 1))
done <<< "$LIST"

# Ротация. Сначала убеждаемся, что после чистки хоть что-то останется: если
# снимки перестали приходить месяц назад, удаление по возрасту опустошит
# каталог ровно в тот момент, когда копии и понадобятся.
KEPT="$(find "$DEST" -name 'noova-*.enc' -type f -mtime "-${KEEP}" | wc -l)"
if [ "$KEPT" -gt 0 ]; then
	find "$DEST" -name 'noova-*.enc' -type f -mtime "+${KEEP}" -print -delete
else
	log "свежих копий нет — ротацию пропускаю, старые не трогаю"
fi
find "$DEST" -name '*.partial' -type f -mtime +1 -delete

# Проверка свежести. Без неё неработающие бэкапы обнаруживаются в тот
# единственный день, когда они нужны.
NEWEST="$(find "$DEST" -name 'noova-*.sql.gz.enc' -type f -printf '%T@ %p\n' \
	| sort -rn | head -1)"
[ -n "$NEWEST" ] || fail "в $DEST нет ни одного дампа базы"
AGE_H=$(( ( $(date +%s) - ${NEWEST%%.*} ) / 3600 ))
[ "$AGE_H" -le "$FRESH" ] || fail "самой свежей копии ${AGE_H} ч (порог ${FRESH}) — снимки на проде не делаются"

TOTAL="$(find "$DEST" -name 'noova-*.enc' -type f | wc -l)"
log "готово: новых ${NEW}, всего ${TOTAL}, свежесть ${AGE_H} ч"

# Внешний монитор (healthchecks.io и подобные): пинг уходит только при
# успехе, поэтому тишина сама по себе становится сигналом тревоги.
if [ -n "$PING" ]; then
	curl -fsS -m 15 "$PING" >/dev/null || log "предупреждение: не достучался до монитора"
fi
