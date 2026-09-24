#!/usr/bin/env bash
#
# Замер нагрузки прода. Запускается НА ПРОДЕ по крону каждые 10 минут (ставит
# watch-setup.sh). Дописывает строку в ~/.noova-backup/load.log — из неё
# суточный отчёт (load-report.sh) считает среднее и пик, а не мгновенный
# снимок в момент отправки: мгновенное значение пик пропускает.
#
# Строка: epoch|ядра|load1|память%|память МБ|диск%|диск ГБ занято|диск ГБ всего|контейнеры
# контейнеры — «api=1.1,postgres=0.0,…» (CPU% из docker stats).
#
# Заодно проверяет пороги и шлёт тревогу в Telegram: нагрузка держится
# (три замера подряд), память или диск на исходе. Настройки — в
# ~/noova-watch.env (тот же файл, что у watch.sh):
#   WATCH_TG_TOKEN, WATCH_TG_CHAT
#   LOAD_ALERT_CPU_PCT=80    # load1 / ядра, три замера подряд
#   LOAD_ALERT_MEM_PCT=90
#   LOAD_ALERT_DISK_PCT=85
#   LOAD_ALERT_COOLDOWN_H=6  # не чаще раза в N часов на один вид тревоги
set -euo pipefail

CONF="${NOOVA_WATCH_CONF:-$HOME/noova-watch.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

STATE="${NOOVA_BACKUP_STATE:-$HOME/.noova-backup}"
LOG="$STATE/load.log"
KEEP_DAYS=8
TOKEN="${WATCH_TG_TOKEN:-}"
CHAT="${WATCH_TG_CHAT:-}"
CPU_MAX="${LOAD_ALERT_CPU_PCT:-80}"
MEM_MAX="${LOAD_ALERT_MEM_PCT:-90}"
DISK_MAX="${LOAD_ALERT_DISK_PCT:-85}"
COOLDOWN=$(( ${LOAD_ALERT_COOLDOWN_H:-6} * 3600 ))
HOST="$(hostname)"

umask 077
mkdir -p "$STATE"

NOW="$(date +%s)"
CORES="$(nproc)"
LOAD1="$(cut -d' ' -f1 "${LOAD_PROC:-/proc/loadavg}")"
# Память из /proc/meminfo, а не из `free`: у минимальных образов нет procps.
# MemAvailable — сколько можно занять без свопа (с учётом сбрасываемого кэша);
# «свободная» память для этого не годится: Linux держит её под кэш диска.
read -r MEM_TOTAL MEM_AVAIL < <(awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { printf "%d %d\n", t / 1024, a / 1024 }' /proc/meminfo)
MEM_PCT=$(( (MEM_TOTAL - MEM_AVAIL) * 100 / MEM_TOTAL ))
read -r DISK_PCT DISK_USED DISK_TOTAL < <(df -Pk / | awk 'NR==2 { gsub("%", "", $5); printf "%d %d %d\n", $5, $3 / 1048576, $2 / 1048576 }')

# docker stats берёт секунду-две; недоступен docker — замер без контейнеров.
CONT=""
if command -v docker >/dev/null 2>&1; then
	CONT="$(docker stats --no-stream --format '{{.Name}}={{.CPUPerc}}' 2>/dev/null \
		| sed -e 's/^noova-//' -e 's/-[0-9]*=/=/' -e 's/%//' | paste -sd, - || true)"
fi

echo "$NOW|$CORES|$LOAD1|$MEM_PCT|$MEM_TOTAL|$DISK_PCT|$DISK_USED|$DISK_TOTAL|$CONT" >> "$LOG"

# Журнал не растёт бесконечно: держим последние KEEP_DAYS суток.
awk -F'|' -v min=$(( NOW - KEEP_DAYS * 86400 )) '$1 >= min' "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

# --- тревоги ------------------------------------------------------------------
tg() {
	[ -n "$TOKEN" ] && [ -n "$CHAT" ] || return 0
	printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TOKEN" \
		| curl -fsS -m 15 -K - --data-urlencode "chat_id=$CHAT" \
			--data-urlencode "parse_mode=HTML" --data-urlencode "text=$1" >/dev/null 2>&1 || true
}

# Тревога не чаще раза в COOLDOWN на вид: держащаяся нагрузка не должна
# слать сообщение каждые десять минут.
alert() {
	local kind="$1" text="$2" stamp="$STATE/last-alert-$1" last=0
	[ -f "$stamp" ] && last="$(cat "$stamp")"
	[ $(( NOW - last )) -ge "$COOLDOWN" ] || return 0
	tg "<b>Server Noova (${HOST}): ${text}</b>"$'\n'"$3"
	echo "$NOW" > "$stamp"
}

cpu_pct() { awk -v l="$1" -v c="$2" 'BEGIN { printf "%d", l / c * 100 }'; }

# Три последних замера подряд выше порога — это не всплеск, а нагрузка.
HIGH="$(tail -n 3 "$LOG" | awk -F'|' -v max="$CPU_MAX" 'NF >= 3 { n++; if ($3 / $2 * 100 >= max) h++ } END { print (n == 3 && h == 3) ? 1 : 0 }')"
if [ "$HIGH" = 1 ]; then
	alert cpu "Высокая нагрузка 🚨" "CPU: <b>$(cpu_pct "$LOAD1" "$CORES")%</b> (load average ${LOAD1}, ядер: ${CORES}), три замера подряд выше ${CPU_MAX}%"
fi
if [ "$MEM_PCT" -ge "$MEM_MAX" ]; then
	alert mem "Память на исходе 🚨" "Занято: <b>${MEM_PCT}%</b> из ${MEM_TOTAL} MB (порог ${MEM_MAX}%)"
fi
if [ "$DISK_PCT" -ge "$DISK_MAX" ]; then
	alert disk "Диск заполняется 🚨" "Занято: <b>${DISK_PCT}%</b> (${DISK_USED} из ${DISK_TOTAL} GB, порог ${DISK_MAX}%)"
fi
