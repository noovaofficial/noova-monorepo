#!/usr/bin/env bash
#
# Ночной цикл резервного копирования. Запускается ПО КРОНУ НА ХРАНИЛИЩЕ,
# настраивает его storage-setup.sh.
#
# Порядок: снять -> проверить -> и только если проверка прошла, удалить
# лишнее (storage-prune.sh). Проверка идёт до ротации, потому что удалять
# старые копии, не убедившись в пригодности свежей, — это ровно тот способ
# остаться совсем без копий.
#
# Снимок делается в момент запроса и приходит потоком: на прод-сервере копии
# не хранятся вовсе. Отсюда следствие, о котором стоит помнить: пока эта
# машина недоступна, резервные копии не делаются нигде. На сервере ничего не
# накапливается «до лучших времён», собирать потом будет нечего.
#
# Закрытый ключ шифрования лежит здесь же: без него копию не проверить, а
# непроверенный бэкап — не бэкап. Плата за это в том, что взлом хранилища
# открывает данные, поэтому на машине не должно быть ничего лишнего.
set -euo pipefail

CONF="${NOOVA_PULL_CONF:-$HOME/noova-pull.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

FROM="${PULL_FROM:-}"
KEY="${PULL_KEY:-$HOME/.ssh/noova-pull}"
DEST="${PULL_DEST:-$HOME/backups}"
FRESH="${PULL_MIN_FRESH_HOURS:-26}"
LOG="${PULL_LOG:-$HOME/noova-pull.log}"
TG_TOKEN="${PULL_TG_TOKEN:-}"
TG_CHAT="${PULL_TG_CHAT:-}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

# --- Telegram ---------------------------------------------------------------
# Сообщения — об успехе и о поломке, одного вида. Не заданы PULL_TG_TOKEN и
# PULL_TG_CHAT — молчит. Токен уходит через конфиг на stdin, а не аргументом:
# иначе он виден в `ps` всем, кто есть на машине. Ошибку отправки глотаем:
# уведомление не должно ронять сам бэкап.
#
# Разметка — HTML (<b>), а не Markdown: причина ошибки — произвольный текст, и
# любой `_` или `*` в нём сломал бы Markdown-разбор и сообщение бы не ушло.
# Всё, что подставляется в сообщение, экранируется (`esc`).
tg() {
	[ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] || return 0
	printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TG_TOKEN" \
		| curl -fsS -m 15 -K - --data-urlencode "chat_id=$TG_CHAT" \
			--data-urlencode "parse_mode=HTML" \
			--data-urlencode "text=$1" >/dev/null 2>&1 || true
}

esc() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# Размер человеческим языком: B, KB, MB, GB — единица всегда названа.
human_size() {
	awk -v b="$1" 'BEGIN {
		if (b < 1024) printf "%d B", b
		else if (b < 1048576) printf "%.0f KB", b / 1024
		else if (b < 1073741824) { v = b / 1048576; if (v < 10) printf "%.1f MB", v; else printf "%.0f MB", v }
		else printf "%.1f GB", b / 1073741824
	}'
}

# Возраст: «0 часов» ничего не говорит — показываем минуты, а для старых копий дни.
human_age() {
	local s="$1" d h m
	if [ "$s" -lt 90 ]; then printf 'только что'; return; fi
	m=$(( s / 60 ))
	if [ "$m" -lt 60 ]; then printf '%d мин назад' "$m"; return; fi
	h=$(( m / 60 )); m=$(( m % 60 ))
	if [ "$h" -lt 24 ]; then printf '%d ч %d мин назад' "$h" "$m"; return; fi
	d=$(( h / 24 )); h=$(( h % 24 ))
	printf '%d д %d ч назад' "$d" "$h"
}

# Метка копии (20260923T234621Z) -> секунды и «23.09.2026 23:46 UTC».
stamp_epoch() { date -u -d "${1:0:4}-${1:4:2}-${1:6:2} ${1:9:2}:${1:11:2}:${1:13:2} UTC" +%s; }
stamp_pretty() { printf '%s.%s.%s %s:%s UTC' "${1:6:2}" "${1:4:2}" "${1:0:4}" "${1:9:2}" "${1:11:2}"; }

# Итоговое сообщение: $1 = ok | error, $2 = причина (для ошибки).
# Что лежит на хранилище считаем с диска на момент отправки, поэтому при
# поломке видно, на что можно откатиться прямо сейчас.
report() {
	[ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] || return 0
	local kind="$1" reason="${2:-}" head total=0 newest="" S text

	if [ "$kind" = ok ]; then head="Успешно ✅"; else head="Ошибка ❌"; fi
	text="<b>Backup Noova: ${head}</b>"
	if [ -n "$reason" ]; then
		text="${text}"$'\n'"Причина: <b>$(printf '%s' "$reason" | esc)</b>"
	fi

	# Полная копия — пара «дамп + фотографии»; одиночный файл копией не считается.
	while read -r S; do
		[ -n "$S" ] || continue
		[ -f "$DEST/noova-media-${S}.tar.gz.enc" ] || continue
		total=$(( total + 1 ))
		[ -n "$newest" ] || newest="$S"
	done < <(ls "$DEST"/noova-*.sql.gz.enc 2>/dev/null | sed 's|.*/noova-||; s|\.sql\.gz\.enc$||' | sort -r)

	local split=""
	if [ -f "$DEST/.rotation" ]; then
		local d w m
		d="$(sed -n 's/^daily=//p' "$DEST/.rotation")"
		w="$(sed -n 's/^weekly=//p' "$DEST/.rotation")"
		m="$(sed -n 's/^monthly=//p' "$DEST/.rotation")"
		split=" (ежедневных: ${d:-0}, недельных: ${w:-0}, месячных: ${m:-0})"
	fi
	text="${text}"$'\n'"Текущее количество копий: <b>${total}</b>${split}"

	if [ -n "$newest" ]; then
		local age label="Свежесть"
		age=$(( $(date +%s) - $(stamp_epoch "$newest") ))
		[ "$kind" = ok ] || label="Свежесть последней копии"
		text="${text}"$'\n'"${label}: <b>$(human_age "$age")</b> ($(stamp_pretty "$newest"))"
		text="${text}"$'\n'"База: <b>$(human_size "$(wc -c < "$DEST/noova-${newest}.sql.gz.enc")")</b>"
		text="${text}"$'\n'"Фото: <b>$(human_size "$(wc -c < "$DEST/noova-media-${newest}.tar.gz.enc")")</b>"
	fi

	# Место на диске: и в отчёте об успехе, и об ошибке — причиной сбоя вполне
	# может быть переполненный диск. Сколько копий ещё поместится, считаем по
	# размеру последней: «хватит на 3 ночи» понятнее, чем гигабайты. Пороги те
	# же, что у /disk в bot.py.
	local dpath="$DEST" total_b free_b pct fits="" mark=""
	[ -d "$dpath" ] || dpath="$HOME"
	read -r total_b free_b < <(df -Pk "$dpath" | awk 'NR==2 { printf "%d %d\n", $2 * 1024, $4 * 1024 }')
	if [ "${total_b:-0}" -gt 0 ]; then
		pct=$(( free_b * 100 / total_b ))
		if [ -n "$newest" ]; then
			local last=$(( $(wc -c < "$DEST/noova-${newest}.sql.gz.enc") + $(wc -c < "$DEST/noova-media-${newest}.tar.gz.enc") ))
			[ "$last" -gt 0 ] && fits=$(( free_b / last ))
		fi
		if [ "$pct" -lt 5 ] || { [ -n "$fits" ] && [ "$fits" -lt 2 ]; }; then mark=" ❌"
		elif [ "$pct" -lt 15 ] || { [ -n "$fits" ] && [ "$fits" -lt 5 ]; }; then mark=" ⚠️"; fi
		text="${text}"$'\n'"Свободно на диске: <b>$(human_size "$free_b")</b> из $(human_size "$total_b") (${pct}%)${mark}"
		[ -z "$fits" ] || text="${text}"$'\n'"Ещё поместится копий: <b>~${fits}</b>"
	fi

	tg "$text"
}

fail() {
	log "ОШИБКА: $1" >&2
	report error "$1"
	exit 1
}

# Журнал обрезаем поверх того же файла, а не через mv: крон держит его
# открытым на дозапись, и подмена inode увела бы весь вывод этого запуска
# в удалённый файл.
if [ -f "$LOG" ] && [ "$(stat -c '%s' "$LOG")" -gt 1048576 ]; then
	KEEP_TAIL="$(tail -n 500 "$LOG")"
	printf '%s\n' "$KEEP_TAIL" > "$LOG"
fi

[ -n "$FROM" ] || fail "не задан PULL_FROM — проверьте $CONF"
[ -f "$KEY" ] || fail "нет ключа $KEY"
mkdir -p "$DEST"

# Один запуск за раз: ночной цикл, ручной запуск и команды бота (bot.py) не
# должны идти вместе — параллельные снимки нагружают прод дважды, а ротация во
# время чужой проверки удалила бы копию из-под неё. Замок общий с bot.py
# (/verify берёт тот же файл). Крон дожидается своей очереди (до получаса),
# бот просит PULL_LOCK_WAIT=0 и получает код 75 — «занято», а не ожидание.
LOCK="${PULL_LOCK:-$HOME/.noova-pull.lock}"
WAIT="${PULL_LOCK_WAIT:-1800}"
if command -v flock >/dev/null 2>&1; then
	exec 9>"$LOCK"
	if [ "$WAIT" = 0 ]; then
		flock -n 9 || { log "пропуск: уже идёт другой запуск"; exit 75; }
	else
		flock -w "$WAIT" 9 || fail "не дождался окончания другого запуска (${WAIT} с)"
	fi
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY="$HERE/storage-verify.sh"
PRUNE="$HERE/storage-prune.sh"
[ -f "$VERIFY" ] || fail "нет $VERIFY — везите скрипты целиком: make backup-storage"
[ -f "$PRUNE" ] || fail "нет $PRUNE — везите скрипты целиком: make backup-storage"

SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15
     -o ServerAliveInterval=30 -o ServerAliveCountMax=6
     -o StrictHostKeyChecking=yes "$FROM")

# --- снимок ----------------------------------------------------------------
# Метку задаёт хранилище: снимок рождается по нашему запросу, и общее для
# обоих файлов имя проще выдать здесь, чем согласовывать с сервером.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$DEST/noova-${STAMP}.sql.gz.enc"
MEDIA="$DEST/noova-media-${STAMP}.tar.gz.enc"

# Пишем в .partial и переименовываем в конце: оборванная передача не должна
# оставить файл под именем готовой копии.
log "снимаю базу ($FROM)"
if ! "${SSH[@]}" snapshot-db > "$DUMP.partial"; then
	rm -f "$DUMP.partial"
	fail "снимок базы не удался — сервер недоступен, ключ не принят или упал pg_dump"
fi
[ -s "$DUMP.partial" ] || { rm -f "$DUMP.partial"; fail "снимок базы пуст"; }
mv "$DUMP.partial" "$DUMP"
log "база: $(du -h "$DUMP" | cut -f1)"

# Строго ПОСЛЕ базы: лишний файл в архиве безвреден, отсутствующий — нет.
# Снимок между базой и архивом добавит файл, на который в базе нет строки;
# обратный порядок дал бы строку без файла, то есть битую анкету.
log "снимаю фотографии"
if ! "${SSH[@]}" snapshot-media > "$MEDIA.partial"; then
	# Дамп без архива фотографий проверить не с чем и восстановить целиком
	# нельзя — оставлять его половиной пары незачем.
	rm -f "$MEDIA.partial" "$DUMP"
	fail "снимок фотографий не удался"
fi
[ -s "$MEDIA.partial" ] || { rm -f "$MEDIA.partial" "$DUMP"; fail "архив фотографий пуст"; }
mv "$MEDIA.partial" "$MEDIA"
log "фотографии: $(du -h "$MEDIA" | cut -f1)"

find "$DEST" -name '*.partial' -type f -mtime +1 -delete

# --- проверка --------------------------------------------------------------
mapfile -t STAMPS < <(
	ls "$DEST"/noova-*.sql.gz.enc 2>/dev/null \
		| sed 's|.*/noova-||; s|\.sql\.gz\.enc$||' | sort -r
)
NEWEST="${STAMPS[0]:-}"
[ -n "$NEWEST" ] || fail "в $DEST нет ни одного дампа базы"

# Проверяем только то, для чего ещё нет отметки: обычно это одна свежая пара.
# Перепроверять каждую ночь весь архив на слабой машине незачем — файлы
# больше не меняются.
BAD=0
for S in ${STAMPS[@]+"${STAMPS[@]}"}; do
	if [ -f "$DEST/noova-${S}.ok" ]; then continue; fi
	[ -f "$DEST/noova-media-${S}.tar.gz.enc" ] || continue
	log "проверяю $S"
	if bash "$VERIFY" "$S"; then
		log "копия $S пригодна"
	else
		date -u +%Y-%m-%dT%H:%M:%SZ > "$DEST/noova-${S}.bad"
		log "ОШИБКА: копия $S не прошла проверку"
		BAD=1
	fi
done

# --- свежесть --------------------------------------------------------------
# Проверка итога: после успешной ночи в каталоге обязана лежать свежая копия.
# Возраст считаем по метке в имени, а не по времени файла: mtime меняется от
# любого копирования, метка — нет.
ISO="${NEWEST:0:4}-${NEWEST:4:2}-${NEWEST:6:2} ${NEWEST:9:2}:${NEWEST:11:2}:${NEWEST:13:2} UTC"
AGE_H=$(( ( $(date +%s) - $(date -d "$ISO" +%s) ) / 3600 ))
[ "$AGE_H" -le "$FRESH" ] || fail "самой свежей копии ${AGE_H} ч (порог ${FRESH})"

# --- ротация ---------------------------------------------------------------
# Только после успешной проверки свежей копии: пока непонятно, есть ли на что
# откатываться, старое не трогаем.
if [ -f "$DEST/noova-${NEWEST}.ok" ]; then
	bash "$PRUNE"
else
	log "свежая копия не прошла проверку — ротацию пропускаю, ничего не удаляю"
fi

TOTAL="$(find "$DEST" -name 'noova-*.sql.gz.enc' -type f | wc -l)"
log "готово: копий ${TOTAL}, свежесть ${AGE_H} ч"

# Битая копия в архиве — повод разобраться, даже если свежая в порядке.
# Ненулевой код заодно не даёт отправить сообщение «Успешно» ниже.
[ "$BAD" = 0 ] || fail "часть копий не прошла проверку — см. файлы *.bad в $DEST"

report ok
