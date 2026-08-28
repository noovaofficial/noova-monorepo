#!/usr/bin/env bash
#
# Создание `.env` на сервере. Повторяет шаблон из
# documentation/deploy/release.md §1.
#
#   ssh deploy@<IP> 'bash -s' -- noova.cc admin@example.com < infra/server/make-env.sh
#
# Секреты рождаются на сервере и никуда не уезжают: ни в буфер обмена, ни
# в историю команд на вашей машине. Существующий файл не перезаписывается —
# перезапись стёрла бы пароль базы, и данные остались бы недоступны.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
DIR="${NOOVA_DIR:-$HOME/noova}"
ENV_FILE="$DIR/.env"

fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$DOMAIN" ] || fail "Укажите домен: ... 'bash -s' -- noova.cc admin@example.com"
[ -n "$EMAIL" ] || fail "Укажите адрес для писем Let's Encrypt вторым аргументом"
case "$DOMAIN" in
  http*|*/*) fail "Домен без схемы и без пути: noova.cc, а не https://noova.cc" ;;
esac

mkdir -p "$DIR"

if [ -f "$ENV_FILE" ]; then
  fail "$ENV_FILE уже есть — не трогаю.
  Перезапись сменила бы POSTGRES_PASSWORD, и база осталась бы недоступна.
  Нужно пересоздать — сохраните старый файл и удалите его вручную."
fi

# Пароль Postgres уходит в строку подключения
# postgresql://user:пароль@postgres:5432/... — слэш и плюс её ломают.
secret() { openssl rand -base64 32 | tr -d '/+='; }
hex() { openssl rand -hex 32; }

umask 077
cat > "$ENV_FILE" <<EOF
# Создан infra/server/make-env.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Секреты сгенерированы здесь же. Резервная копия этого файла — отдельно
# от сервера: без POSTGRES_PASSWORD дамп базы не восстановить.

SITE_DOMAIN=$DOMAIN
SITE_URL=https://$DOMAIN
PUBLIC_API_URL=https://$DOMAIN
MEDIA_BASE_URL=https://$DOMAIN/media
ACME_EMAIL=$EMAIL

POSTGRES_USER=noova
POSTGRES_DB=noova
POSTGRES_PASSWORD=$(secret)
MINIO_ROOT_USER=noova-minio
MINIO_ROOT_PASSWORD=$(secret)

IP_HASH_SALT=$(hex)
INTERNAL_API_TOKEN=$(hex)
REVALIDATE_SECRET=$(hex)

MAIL_DOMAIN=$DOMAIN
MAIL_FROM="Noova <noreply@$DOMAIN>"

# Карта. Публичный сервер OpenStreetMap проксирование не запрещает, но
# требует кэшировать плитки не меньше 7 дней (у нас 30) и слать понятный
# User-Agent с контактом — по нему при проблемах напишут, а безымянный
# блокируют без предупреждения. Коммерческим сервисам политика напоминает,
# что доступ может быть отозван без предупреждения: если карты однажды
# погаснут, меняется только эта строка (см. L-06 в
# documentation/planning/legal.md). Пустое значение выключает карты — вместо
# них остаётся текстовая сноска.
MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
MAP_TILE_USER_AGENT="Noova/1.0 (+https://$DOMAIN; mailto:$EMAIL)"

IMAGE_PREFIX=noova
IMAGE_TAG=latest
EOF
chmod 600 "$ENV_FILE"

printf '\033[32m✓ %s создан\033[0m (%s строк, права 600)\n' "$ENV_FILE" "$(grep -c . "$ENV_FILE")"
printf '  Домен: https://%s\n' "$DOMAIN"
printf '  Секреты: POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD, IP_HASH_SALT,\n'
printf '           INTERNAL_API_TOKEN, REVALIDATE_SECRET — сгенерированы\n'
printf '  Карта: tile.openstreetmap.org, контакт в User-Agent — %s\n\n' "$EMAIL"
printf '  Сделайте копию файла вне сервера: без пароля базы дамп бесполезен.\n'
