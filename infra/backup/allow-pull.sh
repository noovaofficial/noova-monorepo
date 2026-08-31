#!/usr/bin/env bash
#
# Разрешить машине-хранилищу забирать копии. Запускается НА ПРОДЕ:
#
#   make backup-allow-pull SERVER=deploy@<IP> KEY='ssh-ed25519 AAAA… noova-pull'
#
# Ключ хранилища получает не оболочку, а единственную команду pull-guard.sh —
# список копий и выдачу файла. Записать или удалить что-либо этим ключом
# нельзя, поэтому его утечка не даёт доступа к продакшену.
set -euo pipefail

PUBKEY="${1:-}"
GUARD="${NOOVA_DIR:-$HOME/noova}/infra/backup/pull-guard.sh"
AUTH="$HOME/.ssh/authorized_keys"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$PUBKEY" ] || fail "Не передан открытый ключ хранилища"
case "$PUBKEY" in
	ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *) ;;
	*) fail "Это не похоже на открытый ключ: «$PUBKEY»" ;;
esac
# Перевод строки в authorized_keys превратил бы одну запись в две, вторая из
# которых была бы уже без ограничений.
case "$PUBKEY" in *$'\n'*) fail "В ключе перевод строки" ;; esac

[ -f "$GUARD" ] || fail "Нет $GUARD — сначала: make deploy-files SERVER=…"
chmod +x "$GUARD"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$AUTH"

# Старую запись убираем целиком, а не дописываем рядом: два разрешения на
# один и тот же доступ рано или поздно разъезжаются, и понять, какое из них
# действует, уже нельзя.
REST="$(grep -v 'pull-guard\.sh' "$AUTH" || true)"
{
	printf '%s\n' "$REST" | grep -v '^[[:space:]]*$' || true
	# restrict запрещает всё лишнее сразу — проброс портов, агента, tty:
	# перечислять запреты по одному значит когда-нибудь забыть новый.
	printf 'command="%s",restrict %s\n' "$GUARD" "$PUBKEY"
} > "$AUTH.new"
mv "$AUTH.new" "$AUTH"
chmod 600 "$AUTH"

say "Доступ разрешён, команда: $GUARD"
printf '\033[32m✓ хранилище может забирать копии\033[0m\n'
