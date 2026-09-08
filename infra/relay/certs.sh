#!/usr/bin/env bash
#
# Сертификат для машины релея. Запускать НА релее, от root.
#
#   sudo ./certs.sh mail.noova.fyi
#
# Зачем настоящий, а не самоподписанный: api соединяется с релеем через
# открытый интернет и проверяет имя сервера при STARTTLS. Без проверки
# нельзя отличить релей от того, кто встал на пути, — а в теле письма
# одноразовая ссылка на смену пароля.
#
# Требования:
#   1) запись A mail.<домен> уже указывает на эту машину;
#   2) Caddy уже запущен: `docker compose up -d caddy`. 80-й порт занят
#      лендингом постоянно, поэтому certbot не поднимает свой веб-сервер
#      (--standalone туда не встанет), а пишет челлендж в общий с Caddy
#      вебрут — Caddy его и отдаёт (см. Caddyfile, блок mail.<домен>).
#
# Идемпотентен: повторный запуск обновляет файлы и перезапускает контейнер.
set -euo pipefail

DOMAIN="${1:?Использование: certs.sh mail.noova.fyi}"
DIR="$(cd "$(dirname "$0")" && pwd)"
WEBROOT="$DIR/acme-webroot"
LIVE="/etc/letsencrypt/live/$DOMAIN"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запускать от root: sudo $0 $DOMAIN"

# Без -f: у mail.<домен> корень нарочно отвечает 404 (там только челлендж),
# это не ошибка — важно лишь, что Caddy вообще принял соединение на 80-м.
curl -sS --max-time 5 "http://$DOMAIN/" -o /dev/null 2>&1 || \
  fail "Caddy не отвечает на $DOMAIN:80 — сначала 'docker compose up -d caddy'"

command -v certbot >/dev/null 2>&1 || {
  say "Ставлю certbot"
  apt-get update -qq && apt-get install -y -qq certbot
}

install -d -m 755 "$WEBROOT"

if [ ! -d "$LIVE" ]; then
  say "Выпускаю сертификат для $DOMAIN"
  # webroot, а не standalone: 80-й постоянно занят Caddy под лендинг,
  # certbot туда не встанет своим сервером. Файл челленджа кладём в общую
  # с Caddy директорию — Caddy сам отвечает на запрос по нему.
  certbot certonly --webroot -w "$WEBROOT" --non-interactive --agree-tos \
    --register-unsafely-without-email -d "$DOMAIN"
else
  say "Сертификат уже есть, обновляю файлы"
fi

# ---------------------------------------------------------------------------
# Права. Ключ читает smtpd, а он к этому моменту уже под пользователем
# postfix — uid 100, gid 102 в этом образе (он печатает их при старте:
# «System accounts: postfix=100:102»). Поэтому и каталог, и ключ отдаём
# группе 102: с root:root smtpd не пройдёт внутрь каталога и оборвёт
# TLS-рукопожатие с «lost connection after STARTTLS», не сказав почему.
#
# Числа, а не имена: на хосте таких пользователей нет, сопоставление идёт
# по идентификаторам. Сменится образ — сверьтесь с его логом старта.
#
# Копия, а не симлинк на /etc/letsencrypt: внутрь контейнера смонтирован
# только ./certs, и симлинк указывал бы в никуда.
# ---------------------------------------------------------------------------
POSTFIX_GID="${POSTFIX_GID:-102}"

say "Кладу в $DIR/certs"
install -d -m 750 -o root -g "$POSTFIX_GID" "$DIR/certs"
install -m 644 -o root -g "$POSTFIX_GID" "$LIVE/fullchain.pem" "$DIR/certs/fullchain.pem"
install -m 640 -o root -g "$POSTFIX_GID" "$LIVE/privkey.pem" "$DIR/certs/privkey.pem"

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
install -m 644 -o root -g $POSTFIX_GID "$LIVE/fullchain.pem" "$DIR/certs/fullchain.pem"
install -m 640 -o root -g $POSTFIX_GID "$LIVE/privkey.pem" "$DIR/certs/privkey.pem"
cd "$DIR" && docker compose restart smtp
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/relay.sh

say "Готово. Дальше: docker compose up -d"
