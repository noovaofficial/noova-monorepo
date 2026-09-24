#!/usr/bin/env bash
#
# Поставить бота копий на хранилище как systemd-сервис. Запускается НА
# ХРАНИЛИЩЕ, после того как рядом лежат bot.py и pull.sh (make backup-storage
# или scp), и в ~/noova-pull.env заданы PULL_TG_TOKEN, PULL_TG_CHAT и
# PULL_TG_ADMINS:
#
#   bash bot-setup.sh
#
# Нужны python3, flock и sudo (юнит кладётся в /etc/systemd/system). Сервис
# работает от вашего пользователя, а не от root: ему нужен доступ только к
# ~/backups и скриптам.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${NOOVA_PULL_CONF:-$HOME/noova-pull.env}"
UNIT=/etc/systemd/system/noova-backup-bot.service

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

command -v python3 >/dev/null || fail "Нет python3: sudo apt install python3"
command -v flock >/dev/null || fail "Нет flock: sudo apt install util-linux"
[ -f "$HERE/bot.py" ] || fail "Нет $HERE/bot.py"
[ -f "$HERE/pull.sh" ] || fail "Нет $HERE/pull.sh — везите скрипты целиком: make backup-storage"
[ -f "$CONF" ] || fail "Нет $CONF — сначала storage-setup.sh"

# Настройки проверяем до установки: бот с пустым списком админов всё равно не
# стартует, а узнавать об этом из journalctl неудобно.
for VAR in PULL_TG_TOKEN PULL_TG_CHAT PULL_TG_ADMINS; do
	grep -Eq "^${VAR}=.+" "$CONF" || fail "В $CONF не задан $VAR"
done

python3 -c "
import importlib.util, sys
spec = importlib.util.spec_from_file_location('bot', '$HERE/bot.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cfg = m.Config(m.parse_env(open('$CONF').read()))
p = cfg.problems()
sys.exit('; '.join(p)) if p else print('админов:', len(cfg.admins))
" || fail "Настройки бота неверны"

say "Ставлю $UNIT"
sudo tee "$UNIT" >/dev/null <<UNITEOF
[Unit]
Description=Noova backup bot
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$HERE
ExecStart=/usr/bin/env python3 $HERE/bot.py
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNITEOF

sudo systemctl daemon-reload
sudo systemctl enable --now noova-backup-bot.service
sleep 2
systemctl is-active --quiet noova-backup-bot.service \
	|| fail "Сервис не запустился: sudo journalctl -u noova-backup-bot -n 30"

printf '\n\033[32mБот запущен.\033[0m Напишите в группе /help.\n'
printf 'Логи:     sudo journalctl -u noova-backup-bot -f\n'
printf 'Перезапуск: sudo systemctl restart noova-backup-bot\n'
