#!/usr/bin/env bash
#
# Ночной снимок по расписанию. Запускается НА ПРОДЕ:
#
#   make backup-cron SERVER=deploy@<IP>
#
# До этого снимки делались только руками с ноутбука (make backup-fetch), то
# есть ровно тогда, когда о них кто-то вспоминал. Забирает готовые снимки
# хранилище — само, по своему расписанию.
set -euo pipefail

DIR="${NOOVA_DIR:-$HOME/noova}"
AT="${SNAPSHOT_AT:-20 3 * * *}"
LOG="$HOME/noova-snapshot.log"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$DIR/infra/backup/snapshot.sh" ] || fail "Нет $DIR/infra/backup/snapshot.sh — сначала: make deploy-files SERVER=…"
[ -f "$DIR/backup-public.pem" ] || fail "Нет $DIR/backup-public.pem — без него снимок не зашифровать.
  У себя: ./infra/backup/make-key.sh ~/noova-backup
  И привезти: scp ~/noova-backup/backup-public.pem deploy@<IP>:noova/"

# PATH задаём явно: в кроне он урезанный, docker в нём обычно не находится,
# а выясняется это первой же пропущенной ночью.
LINE="$AT export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; cd $DIR && /bin/bash infra/backup/snapshot.sh >> $LOG 2>&1"
CURRENT="$(crontab -l 2>/dev/null || true)"
REST="$(printf '%s\n' "$CURRENT" | grep -v 'snapshot\.sh' || true)"
printf '%s\n%s\n' "$REST" "$LINE" | grep -v '^[[:space:]]*$' | crontab -

say "Снимок в $AT (время машины: $(date +%Z), сейчас $(date +%H:%M))"
printf '\033[32m✓ расписание установлено\033[0m\n'
printf '  журнал: %s\n' "$LOG"
printf '  проверить сейчас: cd %s && bash infra/backup/snapshot.sh\n' "$DIR"
