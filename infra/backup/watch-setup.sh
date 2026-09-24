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
CONFEOF
fi
chmod 600 "$CONF"

# PATH задаём явно: крон даёт урезанный, и curl в нём находится не всегда.
LINE="$AT export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; /bin/bash $WATCH >> $LOG 2>&1"
CURRENT="$(crontab -l 2>/dev/null || true)"
REST="$(printf '%s\n' "$CURRENT" | grep -v 'backup/watch\.sh' || true)"
printf '%s\n%s\n' "$REST" "$LINE" | grep -v '^[[:space:]]*$' | crontab -
say "Расписание: $AT (UTC-время машины)"

printf '\n\033[32mСторож поставлен.\033[0m Осталось:\n'
printf '  1. Вписать WATCH_TG_TOKEN и WATCH_TG_CHAT в %s\n' "$CONF"
printf '  2. Проверить вручную: bash %s\n' "$WATCH"
