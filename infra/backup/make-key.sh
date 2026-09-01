#!/usr/bin/env bash
#
# Пара ключей для шифрования резервных копий (N-29).
#
#   ./infra/backup/make-key.sh ~/noova-backup
#
# Запускается НА ВАШЕЙ машине, не на сервере. Наружу уезжает только открытая
# часть — ею шифруют. Закрытая остаётся у вас: если она будет лежать на том же
# сервере, шифрование защитит ровно от того, чего не случится.
#
# Исключение — машина-хранилище: там закрытая часть нужна, иначе копии некому
# проверять (infra/backup/storage-verify.sh). Из-за этого хранилище само по
# себе становится хранителем персональных данных со всеми вытекающими.
set -euo pipefail

OUT="${1:-}"
[ -n "$OUT" ] || { echo "Укажите каталог: ./infra/backup/make-key.sh ~/noova-backup" >&2; exit 1; }

mkdir -p "$OUT"
PRIVATE="$OUT/backup-private.pem"
PUBLIC="$OUT/backup-public.pem"

[ -f "$PRIVATE" ] && { echo "✗ $PRIVATE уже есть — не трогаю: перезапись сделает старые копии нечитаемыми" >&2; exit 1; }

umask 077
# S/MIME поверх RSA: асимметричное шифрование произвольного объёма без
# симметричного пароля, который пришлось бы держать на сервере.
openssl req -x509 -newkey rsa:4096 -nodes -days 7300 \
  -keyout "$PRIVATE" -out "$PUBLIC" -subj "/CN=noova-backup" 2>/dev/null
chmod 600 "$PRIVATE"
chmod 644 "$PUBLIC"

printf '\033[32m✓ ключи созданы\033[0m\n'
printf '  закрытый: %s  — храните вне сервера, без него копии не прочитать\n' "$PRIVATE"
printf '  открытый: %s  — этот отвезти на сервер:\n' "$PUBLIC"
printf '      scp %s deploy@<IP>:noova/backup-public.pem\n' "$PUBLIC"
