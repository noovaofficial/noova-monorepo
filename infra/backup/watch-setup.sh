#!/usr/bin/env bash
#
# Поставить сторож копий на прод: пульсовой каталог, шаблон настроек и крон.
# Запускается НА ПРОДЕ, после `make deploy-files`:
#
#   bash ~/noova/infra/backup/watch-setup.sh
#
# Токен бота и id чата в аргументы не передаются — они попали бы в историю
# оболочки. Скрипт создаёт ~/noova-watch.env, значения вписываются туда руками.
set -euo pipefail

DIR="${NOOVA_DIR:-$HOME/noova}"
WATCH="$DIR/infra/backup/watch.sh"
CONF="$HOME/noova-watch.env"
STATE="${NOOVA_BACKUP_STATE:-$HOME/.noova-backup}"
LOG="$HOME/noova-watch.log"
AT="${WATCH_AT:-0 9 * * *}"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$WATCH" ] || fail "Нет $WATCH — сначала: make deploy-files SERVER=…"

umask 077
mkdir -p "$STATE"
# Отсчёт «сторож поставлен» — чтобы не тревожить до первой ночи.
[ -f "$STATE/installed" ] || date +%s > "$STATE/installed"

if [ -f "$CONF" ]; then
	say "$CONF уже есть — не трогаю"
else
	say "Создаю $CONF"
	cat > "$CONF" <<CONFEOF
# Настройки сторожа копий. Впишите токен бота (@BotFather) и id чата.
WATCH_TG_TOKEN=
WATCH_TG_CHAT=
WATCH_MAX_HOURS=30
# 1 — писать в Telegram и «всё хорошо» раз в день, не только тревоги.
WATCH_DAILY_OK=0
# Суточный отчёт о нагрузке сервера (среднее и пик за 24 ч). 0 — выключить.
WATCH_LOAD_REPORT=1
# Пороги тревог load-sample.sh (замер раз в 10 минут):
LOAD_ALERT_CPU_PCT=80    # load average / ядра, три замера подряд
LOAD_ALERT_MEM_PCT=90
LOAD_ALERT_DISK_PCT=85
LOAD_ALERT_COOLDOWN_H=6  # не чаще раза в N часов на один вид тревоги
CONFEOF
fi
chmod 600 "$CONF"

# PATH задаём явно: крон даёт урезанный, и curl в нём находится не всегда.
LINE="$AT export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; /bin/bash $WATCH >> $LOG 2>&1"
# Замер нагрузки каждые 10 минут — из него суточный отчёт берёт среднее и пик.
SAMPLE="$DIR/infra/backup/load-sample.sh"
[ -f "$SAMPLE" ] || fail "Нет $SAMPLE — сначала: make deploy-files SERVER=…"
SAMPLE_LINE="*/10 * * * * export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; /bin/bash $SAMPLE >> $HOME/noova-load.log 2>&1"

CURRENT="$(crontab -l 2>/dev/null || true)"
REST="$(printf '%s\n' "$CURRENT" | grep -v 'backup/watch\.sh' | grep -v 'backup/load-sample\.sh' || true)"
printf '%s\n%s\n%s\n' "$REST" "$LINE" "$SAMPLE_LINE" | grep -v '^[[:space:]]*$' | crontab -
say "Расписание сторожа: $AT (UTC-время машины); замер нагрузки: каждые 10 минут"

printf '\n\033[32mСторож поставлен.\033[0m Осталось:\n'
printf '  1. Вписать WATCH_TG_TOKEN и WATCH_TG_CHAT в %s\n' "$CONF"
printf '  2. Проверить вручную: bash %s\n' "$WATCH"
