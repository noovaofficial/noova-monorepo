#!/usr/bin/env bash
#
# Сертификат для машины релея. Запускать НА релее, от root.
#
#   sudo ./certs.sh mail.noova.cc
#
# Зачем настоящий, а не самоподписанный: api соединяется с релеем через
# открытый интернет и проверяет имя сервера при STARTTLS. Без проверки
# нельзя отличить релей от того, кто встал на пути, — а в теле письма
# одноразовая ссылка на смену пароля.
#
# Требования: порт 80 открыт (certbot подтверждает владение через него),
# запись A <домен> уже указывает на эту машину.
#
# Идемпотентен: повторный запуск обновляет файлы и перезапускает контейнер.
set -euo pipefail

DOMAIN="${1:?Использование: certs.sh mail.noova.cc}"
DIR="$(cd "$(dirname "$0")" && pwd)"
LIVE="/etc/letsencrypt/live/$DOMAIN"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запускать от root: sudo $0 $DOMAIN"

command -v certbot >/dev/null 2>&1 || {
  say "Ставлю certbot"
  apt-get update -qq && apt-get install -y -qq certbot
}

if [ ! -d "$LIVE" ]; then
  say "Выпускаю сертификат для $DOMAIN"
  # standalone поднимает свой веб-сервер на 80-м. На релее его никто не
  # занимает — здесь нет ни Caddy, ни сайта.
  certbot certonly --standalone --non-interactive --agree-tos \
    --register-unsafely-without-email -d "$DOMAIN"
else
  say "Сертификат уже есть, обновляю файлы"
fi

# ---------------------------------------------------------------------------
# Postfix читает ключ до того, как сбросит права, поэтому root:root и 640
# ему достаточно. Копия, а не симлинк на /etc/letsencrypt: внутрь контейнера
# смонтирован только ./certs, и симлинк указывал бы в никуда.
# ---------------------------------------------------------------------------
say "Кладу в $DIR/certs"
install -d -m 750 "$DIR/certs"
install -m 644 "$LIVE/fullchain.pem" "$DIR/certs/fullchain.pem"
install -m 640 "$LIVE/privkey.pem" "$DIR/certs/privkey.pem"

# ---------------------------------------------------------------------------
# Продление. Сертификат живёт 90 дней, и без хука обновится он сам, а копии
# в ./certs останутся прежними — почта встанет через три месяца, когда об
# этом уже никто не будет помнить.
# ---------------------------------------------------------------------------
say "Ставлю хук продления"
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/relay.sh <<EOF
#!/usr/bin/env bash
set -eu
install -m 644 "$LIVE/fullchain.pem" "$DIR/certs/fullchain.pem"
install -m 640 "$LIVE/privkey.pem" "$DIR/certs/privkey.pem"
cd "$DIR" && docker compose restart smtp
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/relay.sh

say "Готово. Дальше: docker compose up -d"
