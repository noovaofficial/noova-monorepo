#!/usr/bin/env bash
#
# Ротация копий на хранилище: две ежедневных, одна недельная, одна месячная.
#
#   bash storage-prune.sh            # удалить лишнее
#   PRUNE_DRY_RUN=1 bash storage-prune.sh
#
# Вызывается из pull.sh после успешной проверки — если свежая копия не прошла
# проверку, не удаляется ничего.
#
# Что остаётся, ровно:
#   1) две самых свежих копии;
#   2) самая свежая из оставшихся, снятая на прошлой неделе или раньше;
#   3) самая свежая из оставшихся, снятая в прошлом месяце или раньше.
# Слоты не пересекаются, поэтому копий всегда не больше четырёх. В начале
# недели «недельная» оказывается лишь на день-два старше вчерашней — так
# устроен календарь, и одна недельная копия глубже отката не даёт.
#
# Правила намеренно сформулированы через «самая свежая из тех, что старше», а
# не через возраст в днях. Возрастное правило («держать копию 30-дневной
# давности») невыполнимо: чтобы такая копия была, её надо не удалять все
# предыдущие 30 дней, а под правилом «старше 7, но моложе 30» она под удаление
# как раз попадает. Здесь же копия, ставшая недельной, остаётся ею до конца
# недели, а затем либо становится месячной, либо уходит — разрывов не бывает.
set -euo pipefail

CONF="${NOOVA_PULL_CONF:-$HOME/noova-pull.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

DIR="${PULL_DEST:-$HOME/backups}"
DAILY="${PULL_KEEP_DAILY:-2}"
DRY="${PRUNE_DRY_RUN:-}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

# Метки берём из имён, а не из времени файла: mtime — это когда копию
# скачали, а нас интересует, когда её сняли.
mapfile -t STAMPS < <(
	ls "$DIR"/noova-*.sql.gz.enc 2>/dev/null \
		| sed 's|.*/noova-||; s|\.sql\.gz\.enc$||' | sort -r
)

# PRUNE_NOW подменяет «сегодня» (YYYYMMDD). Нужен, чтобы прогонять политику
# хранения по месяцу вперёд и убеждаться, что месячная копия не исчезает на
# стыке недель — руками такое не проверить.
NOW="${PRUNE_NOW:-$(date -u +%Y%m%d)}"
NOW_ISO="${NOW:0:4}-${NOW:4:2}-${NOW:6:2}"
NOW_WEEK="$(date -u -d "$NOW_ISO" +%G-%V)"
NOW_MONTH="${NOW:0:6}"

KEEP=()
kept() {
	local S
	for S in ${KEEP[@]+"${KEEP[@]}"}; do
		if [ "$S" = "$1" ]; then return 0; fi
	done
	return 1
}

WEEKLY=""
MONTHLY=""
N=0
for STAMP in ${STAMPS[@]+"${STAMPS[@]}"}; do
	# Пара обязательна: дамп без архива фотографий восстановить целиком
	# нельзя, поэтому за полноценную копию он не считается.
	[ -f "$DIR/noova-media-${STAMP}.tar.gz.enc" ] || continue

	D="${STAMP%T*}"
	ISO="${D:0:4}-${D:4:2}-${D:6:2}"
	WEEK="$(date -u -d "$ISO" +%G-%V 2>/dev/null || echo '?')"
	MONTH="${D:0:6}"

	N=$((N + 1))
	if [ "$N" -le "$DAILY" ]; then
		KEEP+=("$STAMP")
		continue
	fi
	if [ -z "$WEEKLY" ] && [ "$WEEK" != "$NOW_WEEK" ]; then
		WEEKLY="$STAMP"
		kept "$STAMP" || KEEP+=("$STAMP")
		continue
	fi
	if [ -z "$MONTHLY" ] && [ "$MONTH" != "$NOW_MONTH" ]; then
		MONTHLY="$STAMP"
		kept "$STAMP" || KEEP+=("$STAMP")
	fi
done

# Копий может быть меньше, чем ролей: в первые дни всё попадает в «ежедневные»,
# и удалять нечего.
[ "${#KEEP[@]}" -gt 0 ] || { log "нечего хранить — каталог пуст, ротацию пропускаю"; exit 0; }

REMOVED=0
for STAMP in ${STAMPS[@]+"${STAMPS[@]}"}; do
	if kept "$STAMP"; then continue; fi
	if [ -n "$DRY" ]; then
		log "удалил бы $STAMP"
	else
		rm -f "$DIR/noova-${STAMP}.sql.gz.enc" \
		      "$DIR/noova-media-${STAMP}.tar.gz.enc" \
		      "$DIR/noova-${STAMP}.ok" \
		      "$DIR/noova-${STAMP}.bad"
		log "удалил $STAMP"
	fi
	REMOVED=$((REMOVED + 1))
done

# Осиротевшие архивы фотографий: дамп к ним уже удалён или не доехал.
for M in "$DIR"/noova-media-*.tar.gz.enc; do
	[ -e "$M" ] || continue
	S="$(basename "$M" | sed 's|^noova-media-||; s|\.tar\.gz\.enc$||')"
	if [ -f "$DIR/noova-${S}.sql.gz.enc" ]; then continue; fi
	if [ -n "$DRY" ]; then log "удалил бы архив без дампа: $S"; else rm -f "$M"; log "удалил архив без дампа: $S"; fi
done

log "оставлено ${#KEEP[@]} (ежедневных до ${DAILY}, недельная ${WEEKLY:-—}, месячная ${MONTHLY:-—}), удалено ${REMOVED}"
