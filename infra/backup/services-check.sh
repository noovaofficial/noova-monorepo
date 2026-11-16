#!/usr/bin/env bash
#
# Внешняя проверка сервисов. Запускается НА ХРАНИЛИЩЕ по крону каждые пять
# минут (ставит storage-setup.sh).
#
# Зачем. Проверка здоровья контейнера видит только сам процесс: 16 ноября 2026
# админка почты восемь дней отвечала 404, а контейнер числился healthy. Что
# сервис действительно отвечает снаружи, может сказать только другая машина —
# хранилище как раз такая: оно не на проде и не на релее.
#
# Что проверяется (всё задаётся в ~/noova-pull.env, пустой список — пропуск):
#   CHECK_HTTP  адреса, которые должны отвечать 2xx (после перенаправлений)
#   CHECK_TCP   host:port — порт должен принимать соединение
#   CHECK_TLS   host:port — сертификат не истекает в ближайшие CHECK_TLS_DAYS
#
# Сообщения — в тот же чат и топик, что и отчёты о копиях (PULL_TG_*).
# Чтобы не шуметь: тревога уходит после CHECK_FAILS неудач подряд (одиночный
# сбой сети — не поломка), повторяется раз в CHECK_REMIND_HOURS, а когда
# сервис вернулся — приходит одно сообщение о восстановлении.
set -uo pipefail

CONF="${NOOVA_PULL_CONF:-$HOME/noova-pull.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

HTTP_LIST="${CHECK_HTTP:-}"
TCP_LIST="${CHECK_TCP:-}"
TLS_LIST="${CHECK_TLS:-}"
TLS_DAYS="${CHECK_TLS_DAYS:-14}"
FAILS="${CHECK_FAILS:-2}"
REMIND_H="${CHECK_REMIND_HOURS:-6}"
STATE="${NOOVA_CHECK_STATE:-$HOME/.noova-check}"
TG_TOKEN="${PULL_TG_TOKEN:-}"
TG_CHAT="${PULL_TG_CHAT:-}"
TG_TOPIC="${PULL_TG_TOPIC:-}"

mkdir -p "$STATE"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }
esc() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# Тот же способ отправки, что в pull.sh: токен — через конфиг на stdin, чтобы
# его не было видно в `ps`.
tg() {
	[ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] || { log "Telegram не настроен: $1"; return 0; }
	{
		printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TG_TOKEN"
		[ -n "$TG_TOPIC" ] && printf 'data-urlencode = "message_thread_id=%s"\n' "$TG_TOPIC"
		true
	} | curl -fsS -m 15 -K - --data-urlencode "chat_id=$TG_CHAT" \
			--data-urlencode "parse_mode=HTML" \
			--data-urlencode "text=$1" >/dev/null 2>&1 || log "не удалось отправить в Telegram"
}

# Команда с ограничением по времени: `timeout` есть на любом Linux, но не
# везде, где скрипт запускают руками для проверки.
limited() {
	local seconds="$1"; shift
	if command -v timeout >/dev/null 2>&1; then timeout "$seconds" "$@"; else "$@"; fi
}

# --- сами проверки: печатают причину сбоя и возвращают 1, иначе молчат -------

check_http() {
	local code
	code="$(curl -sS -L -m 20 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" || code="000"
	case "$code" in
		2??) return 0 ;;
		000) printf 'нет ответа'; return 1 ;;
		*) printf 'ответ %s' "$code"; return 1 ;;
	esac
}

check_tcp() {
	local host="${1%:*}" port="${1##*:}"
	if limited 10 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then return 0; fi
	printf 'порт закрыт'
	return 1
}

check_tls() {
	local host="${1%:*}" port="${1##*:}" end end_s left
	end="$(printf '' | limited 15 openssl s_client -connect "$host:$port" -servername "$host" 2>/dev/null \
		| openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
	if [ -z "$end" ]; then printf 'сертификат не получен'; return 1; fi
	# GNU date на Linux, BSD date — при ручном запуске на macOS.
	end_s="$(date -u -d "$end" +%s 2>/dev/null || date -u -j -f '%b %e %T %Y %Z' "$end" +%s 2>/dev/null)"
	if [ -z "$end_s" ]; then printf 'не разобрана дата сертификата'; return 1; fi
	left=$(( (end_s - $(date +%s)) / 86400 ))
	if [ "$left" -lt 0 ]; then printf 'сертификат истёк'; return 1; fi
	if [ "$left" -lt "$TLS_DAYS" ]; then printf 'сертификат истекает через %d дн.' "$left"; return 1; fi
	return 0
}

# --- учёт состояния ----------------------------------------------------------
# На каждую цель — файл: число неудач подряд и время последней тревоги.
# Имя файла — хэш цели: в адресах есть `/` и `:`.

NOW="$(date +%s)"
PROBLEMS=""
RECOVERED=""
ALERT=0

track() {
	local kind="$1" target="$2" reason="$3" file count=0 alerted=0
	file="$STATE/$(printf '%s %s' "$kind" "$target" | cksum | cut -d' ' -f1)"
	if [ -f "$file" ]; then read -r count alerted < "$file" || true; fi
	count="${count:-0}"; alerted="${alerted:-0}"

	if [ -z "$reason" ]; then
		if [ "$alerted" != 0 ]; then
			RECOVERED="${RECOVERED}"$'\n'"✅ $(printf '%s' "$target" | esc)"
		fi
		rm -f "$file"
		return
	fi

	count=$(( count + 1 ))
	log "сбой ($count): $kind $target — $reason"
	if [ "$count" -ge "$FAILS" ]; then
		PROBLEMS="${PROBLEMS}"$'\n'"❌ $(printf '%s' "$target" | esc) — <b>$(printf '%s' "$reason" | esc)</b>"
		# Первая тревога по цели или пора напомнить.
		if [ "$alerted" = 0 ] || [ $(( (NOW - alerted) / 3600 )) -ge "$REMIND_H" ]; then
			ALERT=1
			alerted="$NOW"
		fi
	fi
	printf '%s %s\n' "$count" "$alerted" > "$file"
}

for TARGET in $HTTP_LIST; do track http "$TARGET" "$(check_http "$TARGET")"; done
for TARGET in $TCP_LIST; do track tcp "$TARGET" "$(check_tcp "$TARGET")"; done
for TARGET in $TLS_LIST; do track tls "$TARGET" "$(check_tls "$TARGET")"; done

if [ "$ALERT" = 1 ]; then
	tg "<b>Сервисы Noova: Тревога 🚨</b>${PROBLEMS}"
fi
if [ -n "$RECOVERED" ]; then
	tg "<b>Сервисы Noova: Восстановлено ✅</b>${RECOVERED}"
fi

[ -z "$PROBLEMS" ] || exit 1
