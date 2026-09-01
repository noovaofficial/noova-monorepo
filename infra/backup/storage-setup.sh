#!/usr/bin/env bash
#
# Подготовка машины-хранилища. Запускается НА ХРАНИЛИЩЕ, рядом должен лежать
# pull.sh — оба файла привозит `make backup-storage`.
#
#   bash storage-setup.sh deploy@<IP прода>
#
# Идемпотентно: ключ и строку крона не пересоздаёт, повторный запуск только
# обновляет настройки.
set -euo pipefail

FROM="${1:-}"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$FROM" ] || fail "Укажите адрес прода: bash storage-setup.sh deploy@<IP>"
case "$FROM" in *@*) ;; *) fail "Нужен адрес вида deploy@<IP>, а не «$FROM»" ;; esac
HOST="${FROM#*@}"

HERE="$(cd "$(dirname "$0")" && pwd)"
PULL="$HERE/pull.sh"
for F in pull.sh storage-verify.sh storage-prune.sh; do
	[ -f "$HERE/$F" ] || fail "Рядом нет $F — везите скрипты целиком: make backup-storage"
	chmod +x "$HERE/$F"
done

# Закрытый ключ. Без него копию не проверить, а непроверенная копия — не
# копия, поэтому настройка без ключа не имеет смысла и здесь прерывается.
PRIVATE="${PULL_PRIVATE_KEY:-$HOME/backup-private.pem}"
[ -f "$PRIVATE" ] || fail "Нет закрытого ключа $PRIVATE.
  Он нужен здесь, чтобы проверять копии без участия человека.
  Привезти: make backup-storage STORAGE=… SERVER=… KEY=~/noova-backup/backup-private.pem"
chmod 600 "$PRIVATE"

KEY="$HOME/.ssh/noova-pull"
DEST="${PULL_DEST:-$HOME/backups}"
CONF="$HOME/noova-pull.env"
LOG="$HOME/noova-pull.log"
AT="${PULL_AT:-17 4 * * *}"

# --- каталог ---------------------------------------------------------------
# 700, а не 755: копии зашифрованы, но список имён со временем снимков —
# тоже сведения, которых посторонним на машине знать незачем.
mkdir -p "$DEST"
chmod 700 "$DEST"

# --- ключ ------------------------------------------------------------------
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ -f "$KEY" ]; then
	say "Ключ $KEY уже есть — оставляю"
else
	say "Создаю ключ доступа к проду"
	ssh-keygen -t ed25519 -N '' -f "$KEY" -C 'noova-pull' >/dev/null
fi

# --- ключ хоста ------------------------------------------------------------
# StrictHostKeyChecking=yes в pull.sh не даст подключиться к неизвестному
# хосту. Записываем ключ прода заранее и показываем отпечаток: сверить его
# глазами — единственный момент, когда подмену вообще можно заметить.
if ssh-keygen -F "$HOST" >/dev/null 2>&1; then
	say "Ключ хоста $HOST уже в known_hosts"
else
	say "Запоминаю ключ хоста $HOST"
	ssh-keyscan -T 10 "$HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null \
		|| fail "Не отвечает $HOST — проверьте адрес и firewall"
fi

# --- настройки -------------------------------------------------------------
say "Пишу $CONF"
umask 077
cat > "$CONF" <<CONFEOF
# Настройки вывоза копий. Меняются здесь, pull.sh их подхватывает.
PULL_FROM=$FROM
PULL_KEY=$KEY
PULL_DEST=$DEST
PULL_PRIVATE_KEY=$PRIVATE
# Сколько ежедневных копий держать. Сверх них ротация оставляет одну
# недельную и одну месячную — см. storage-prune.sh.
PULL_KEEP_DAILY=${PULL_KEEP_DAILY:-2}
PULL_MIN_FRESH_HOURS=${PULL_MIN_FRESH_HOURS:-26}
# Необязательно: URL внешнего монитора, пинг уходит только при успехе.
PULL_PING_URL=${PULL_PING_URL:-}
CONFEOF

# --- расписание ------------------------------------------------------------
# PATH задаём явно: крон даёт урезанный, и ssh с curl в нём находятся не
# всегда — выясняется это первой же пропущенной ночью.
LINE="$AT export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; /bin/bash $PULL >> $LOG 2>&1"
CURRENT="$(crontab -l 2>/dev/null || true)"
REST="$(printf '%s\n' "$CURRENT" | grep -v 'pull\.sh' || true)"
printf '%s\n%s\n' "$REST" "$LINE" | grep -v '^[[:space:]]*$' | crontab -
say "Расписание: $AT (UTC-время машины)"

printf '\n\033[32mХранилище готово.\033[0m Осталось разрешить ему забирать копии.\n\n'
printf 'Отпечаток ключа %s — сверьте с тем, что печатает на проде\n' "$HOST"
printf '  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\n'
ssh-keygen -F "$HOST" -l | sed 's/^/  /' || true
printf '\nТеперь у себя на машине выполните:\n\n'
printf '  make backup-allow-pull SERVER=%s KEY=%s\n\n' "$FROM" "'$(cat "$KEY.pub")'"
printf 'После этого проверьте вручную:\n  bash %s\n' "$PULL"
printf '\nХранение: %s ежедневных + недельная + месячная.\n' "${PULL_KEEP_DAILY:-2}"
printf 'Лишнее удаляется только после успешной проверки свежей копии.\n'
