#!/usr/bin/env bash
#
# Тревоги по журналу api. Запускается НА ПРОДЕ по крону каждые пять минут
# (ставит watch-setup.sh), пишет в тот же чат и топик, что и сторож копий
# (WATCH_TG_* из ~/noova-watch.env).
#
# Зачем. 18–27 ноября 2026 у контейнеров на проде не работал DNS: девять
# дней не уходили письма и падали пополнения (500 на /billing/topups). Сервер
# при этом был здоров по всем внешним проверкам, а узнали о поломке от
# клиента. Видно это было только в журнале api — его здесь и читаем.
#
# Что считается (за время с прошлого запуска):
#   письма   «не уходит дольше 10 минут», «попытки исчерпаны», «отклонено
#            почтовым сервером» — строки из apps/api/src/modules/auth/mail-queue.ts
#            (MAIL_LOG); менять только вместе;
#   оплаты   «Paymento не создал платёж» (billing/routes.ts);
#   5xx      ответы api с кодом 5xx — от APP_ALERT_5XX штук (по умолчанию 5).
#
# Чтобы не шуметь: по каждому виду — не чаще раза в APP_ALERT_COOLDOWN_MIN
# минут (по умолчанию 60); пропущенное за это время не теряется, а
# суммируется в следующее сообщение. Адресов почты в сообщении нет: чат —
# не место для персональных данных; они в журнале, команда — в сообщении.
set -uo pipefail

CONF="${NOOVA_WATCH_CONF:-$HOME/noova-watch.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

DIR="${NOOVA_DIR:-$HOME/noova}"
STATE="${NOOVA_ALERT_STATE:-$HOME/.noova-alerts}"
COOLDOWN_S=$(( ${APP_ALERT_COOLDOWN_MIN:-60} * 60 ))
MIN_5XX="${APP_ALERT_5XX:-5}"
TOKEN="${WATCH_TG_TOKEN:-}"
CHAT="${WATCH_TG_CHAT:-}"
TOPIC="${WATCH_TG_TOPIC:-}"
HOST="$(hostname)"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

# Тот же способ отправки, что в watch.sh: токен — через конфиг на stdin,
# чтобы его не было видно в `ps`.
tg() {
	[ -n "$TOKEN" ] && [ -n "$CHAT" ] || { log "Telegram не настроен: $1"; return 0; }
	{
		printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TOKEN"
		[ -n "$TOPIC" ] && printf 'data-urlencode = "message_thread_id=%s"\n' "$TOPIC"
		true
	} | curl -fsS -m 15 -K - --data-urlencode "chat_id=$CHAT" \
			--data-urlencode "parse_mode=HTML" --data-urlencode "text=$1" >/dev/null 2>&1 \
		|| log "не удалось отправить в Telegram"
}

mkdir -p "$STATE"
NOW="$(date +%s)"
# Первый запуск — смотрим последние пять минут, а не весь журнал с выката.
SINCE="$(cat "$STATE/last-run" 2>/dev/null || echo $(( NOW - 300 )))"

LOGS="$(cd "$DIR" && docker compose logs api --no-log-prefix --since "$SINCE" --until "$NOW" 2>/dev/null)" || {
	log "журнал api не прочитан (docker compose logs)"
	exit 1
}
printf '%s\n' "$NOW" > "$STATE/last-run"

count() { printf '%s\n' "$LOGS" | grep -cF -- "$1" || true; }

MAIL_STUCK="$(count '"msg":"письмо не уходит дольше 10 минут"')"
MAIL_DROPPED="$(count '"msg":"письмо не отправлено, попытки исчерпаны"')"
MAIL_REJECTED="$(count '"msg":"письмо отклонено почтовым сервером"')"
PAY="$(count '"msg":"Paymento не создал платёж"')"
# Строки завершения запроса: у них есть responseTime и код ответа.
E5XX="$(printf '%s\n' "$LOGS" | grep -F '"responseTime"' | grep -cE '"statusCode":5[0-9]{2}' || true)"
[ "$E5XX" -ge "$MIN_5XX" ] || E5XX=0

# Накопитель по виду: «сколько с прошлого сообщения» и «когда было сообщение».
# Печатает итоговое число, если пора сообщить, иначе пусто.
due() {
	local kind="$1" add="$2" file="$STATE/$1" pending=0 sent=0
	if [ -f "$file" ]; then read -r pending sent < "$file" || true; fi
	pending=$(( ${pending:-0} + add )); sent="${sent:-0}"
	if [ "$pending" -gt 0 ] && [ $(( NOW - sent )) -ge "$COOLDOWN_S" ]; then
		printf '0 %s\n' "$NOW" > "$file"
		printf '%s' "$pending"
	else
		printf '%s %s\n' "$pending" "$sent" > "$file"
	fi
}

LINES=""
add_line() { [ -z "$1" ] || LINES="${LINES}"$'\n'"$2"; }

N="$(due mail-stuck "$MAIL_STUCK")"
add_line "$N" "📭 Письма не уходят дольше 10 минут: <b>$N</b> (очередь повторяет их сутки)"
N="$(due mail-dropped "$MAIL_DROPPED")"
add_line "$N" "❌ Письма потеряны после суток попыток: <b>$N</b>"
N="$(due mail-rejected "$MAIL_REJECTED")"
add_line "$N" "↩️ Письма отклонены почтовым сервером (5xx): <b>$N</b>"
N="$(due payments "$PAY")"
add_line "$N" "💳 Paymento не создал платёж: <b>$N</b>"
N="$(due http-5xx "$E5XX")"
add_line "$N" "🔥 Ответы api с ошибкой 5xx: <b>$N</b>"

if [ -z "$LINES" ]; then
	exit 0
fi

log "тревога:$(printf '%s' "$LINES" | tr '\n' ' ')"
tg "<b>Server Noova (${HOST}): Тревога 🚨</b>${LINES}
Подробности: <code>cd ~/noova &amp;&amp; docker compose logs api --since 2h | grep '\"level\":5'</code>"
exit 1
