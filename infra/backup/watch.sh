#!/usr/bin/env bash
#
# Сторож копий. Запускается НА ПРОДЕ по крону раз в день (ставит watch-setup.sh).
#
# Зачем он на проде, а не на хранилище. Хранилище само сообщает о поломке
# (pull.sh пишет в Telegram), но молчит ровно тогда, когда выключено, сломан
# его крон или ключ. Тишину заметить может только другая машина. Прод её и
# замечает: pull-guard.sh при каждой выдаче копии пишет пульс
# (~/.noova-backup/last-db, last-media), а здесь проверяется его возраст.
# Доступа к хранилищу этому сторожу не нужно — а давать проду ключ к машине,
# где лежит закрытый ключ шифрования копий, нельзя: взлом сервера открыл бы всё.
#
# Настройки — в ~/noova-watch.env (chmod 600):
#   WATCH_TG_TOKEN=токен бота
#   WATCH_TG_CHAT=id чата
#   WATCH_MAX_HOURS=30      # старше — тревога (ночной цикл + запас)
#   WATCH_DAILY_OK=1        # необязательно: писать и «всё хорошо» раз в день
set -euo pipefail

CONF="${NOOVA_WATCH_CONF:-$HOME/noova-watch.env}"
if [ -f "$CONF" ]; then . "$CONF"; fi

STATE="${NOOVA_BACKUP_STATE:-$HOME/.noova-backup}"
MAX_H="${WATCH_MAX_HOURS:-30}"
TOKEN="${WATCH_TG_TOKEN:-}"
CHAT="${WATCH_TG_CHAT:-}"
HOST="$(hostname)"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

tg() {
	[ -n "$TOKEN" ] && [ -n "$CHAT" ] || { log "Telegram не настроен: $1"; return 0; }
	printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TOKEN" \
		| curl -fsS -m 15 -K - --data-urlencode "chat_id=$CHAT" \
			--data-urlencode "parse_mode=HTML" --data-urlencode "text=$1" >/dev/null 2>&1 \
		|| log "не удалось отправить в Telegram"
}

# Возраст человеческим языком — как в pull.sh: «0 часов» ничего не говорит.
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

NOW="$(date +%s)"
INSTALLED="$(cat "$STATE/installed" 2>/dev/null || echo "$NOW")"
BAD=0
DB_LINE=""
MEDIA_LINE=""

for WHAT in db media; do
	if [ -f "$STATE/last-$WHAT" ]; then
		AGE_S=$(( NOW - $(cat "$STATE/last-$WHAT") ))
		LINE="$(human_age "$AGE_S")"
		if [ $(( AGE_S / 3600 )) -gt "$MAX_H" ]; then BAD=1; LINE="${LINE} ⚠️"; fi
	else
		# Ни одной выдачи. Пока сторож поставлен недавно, молчим: первая ночь
		# ещё не наступала. Позже — уже поломка.
		LINE="ещё ни разу"
		if [ $(( (NOW - INSTALLED) / 3600 )) -gt "$MAX_H" ]; then BAD=1; LINE="${LINE} ⚠️"; fi
	fi
	if [ "$WHAT" = db ]; then DB_LINE="$LINE"; else MEDIA_LINE="$LINE"; fi
done

BODY="База забирали: <b>${DB_LINE}</b>
Фото забирали: <b>${MEDIA_LINE}</b>"

if [ "$BAD" = 1 ]; then
	MSG="<b>Backup Noova: Тревога 🚨</b>
Причина: <b>хранилище перестало забирать копии</b> (порог ${MAX_H} ч)
${BODY}
Проверьте хранилище: tail ~/noova-pull.log, crontab -l, доступность машины."
	log "хранилище не забирает копии: db ${DB_LINE}, media ${MEDIA_LINE}"
	tg "$MSG"
	exit 1
fi

log "копии забираются: db ${DB_LINE}, media ${MEDIA_LINE}"
if [ "${WATCH_DAILY_OK:-0}" = 1 ]; then
	tg "<b>Backup Noova: Хранилище забирает копии ✅</b>
${BODY}"
fi
