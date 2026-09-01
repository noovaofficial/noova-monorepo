#!/usr/bin/env bash
#
# Переезд стека на другую машину. Домен остаётся прежним.
#
#   make migrate-server FROM=deploy@<старый> TO=deploy@<новый> \
#                       KEY=~/noova-backup/backup-private.pem \
#                       [RELAY=deploy@<релей>] [DIR=~/noova-migration]
#
# Что здесь есть такого, чего нет в ручном порядке из migration.md §2.
#
# 1. Образы переносятся, а не пересобираются. Сборка идёт под чужую платформу
#    через эмуляцию — десятки минут. Но дело не в скорости: перенос даёт на
#    новой машине ровно то, что работало на старой, с тем же идентификатором.
#    Пересборка того же коммита такой гарантии не даёт.
# 2. `.env` переносится целиком. Сгенерировать заново нельзя: с другим
#    POSTGRES_PASSWORD дамп не восстановится, и это выясняется в конце.
# 3. Отказ, если на целевой машине уже есть стек. Одна опечатка в TO= — и
#    восстановление легло бы поверх живой базы.
# 4. Остановка перед переключением DNS. До него всё обратимо: старый сервер
#    работает, трафик идёт на него. После — нет, и решение принимает человек,
#    посмотревший на новый сервер своими глазами.
#
# Старый сервер открывается только на чтение. Скрипт на нём ничего не меняет.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FROM="${FROM:-}"
TO="${TO:-}"
KEY="${KEY:-}"
RELAY="${RELAY:-}"
DIR="${DIR:-$HOME/noova-migration}"
REMOTE_DIR="${REMOTE_DIR:-noova}"

step() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15"

[ -n "$FROM" ] || fail "Укажите FROM=deploy@<старый>"
[ -n "$TO" ] || fail "Укажите TO=deploy@<новый>"
[ -n "$KEY" ] || fail "Укажите KEY=путь к закрытому ключу бэкапов"
[ "$FROM" != "$TO" ] || fail "FROM и TO совпадают"
[ -f "$KEY" ] || fail "Ключ не найден: $KEY"

# ---------------------------------------------------------------------------
# Предполётные проверки. Дешевле упасть здесь, чем на середине переноса.
# ---------------------------------------------------------------------------
step "Проверки"

$SSH "$FROM" true 2>/dev/null || fail "Нет доступа по ssh к $FROM (нужен ключ без пароля)"
ok "ssh до $FROM"
$SSH "$TO" true 2>/dev/null || fail "Нет доступа по ssh к $TO"
ok "ssh до $TO"
if [ -n "$RELAY" ]; then
  $SSH "$RELAY" true 2>/dev/null || fail "Нет доступа по ssh к $RELAY"
  ok "ssh до $RELAY"
fi

$SSH "$FROM" "test -f $REMOTE_DIR/.env" || fail "На $FROM нет $REMOTE_DIR/.env — это точно старый сервер?"
ok "$FROM: стек на месте"

$SSH "$TO" "docker ps >/dev/null" 2>/dev/null \
  || fail "На $TO нет Docker или пользователь не в группе docker. Сначала: make server-setup SERVER=root@<IP>"
ok "$TO: Docker работает"

# Главный предохранитель. Существующий .env означает работающую установку,
# и восстановление затёрло бы её базу.
if $SSH "$TO" "test -e $REMOTE_DIR/.env"; then
  fail "На $TO уже есть $REMOTE_DIR/.env — там развёрнут стек.
  Переезд затёр бы его базу. Уберите файл вручную, если машина действительно пустая."
fi
ok "$TO: пусто, затирать нечего"

if $SSH "$TO" "docker volume inspect ${REMOTE_DIR}_postgres_data >/dev/null 2>&1"; then
  fail "На $TO есть том ${REMOTE_DIR}_postgres_data с данными базы.
  Удалить: ssh $TO 'docker volume rm ${REMOTE_DIR}_postgres_data'"
fi
ok "$TO: тома базы нет"

mkdir -p "$DIR"

# ---------------------------------------------------------------------------
step "1/7 Снимок со старого сервера"
# ---------------------------------------------------------------------------
# Снимок идёт потоком прямо сюда: на сервере копии не хранятся, забирать
# оттуда нечего. Сначала база, потом фотографии — порядок не случаен: снимок
# между ними добавит файл без строки в базе (безвредно), обратный порядок дал
# бы строку без файла, то есть битую анкету.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_ENC="$DIR/noova-${STAMP}.sql.gz.enc"
MEDIA_ENC="$DIR/noova-media-${STAMP}.tar.gz.enc"

$SSH "$FROM" "cd $REMOTE_DIR && bash infra/backup/stream.sh db" > "$DUMP_ENC.partial" \
  || { rm -f "$DUMP_ENC.partial"; fail "Снимок базы не удался"; }
mv "$DUMP_ENC.partial" "$DUMP_ENC"

$SSH "$FROM" "cd $REMOTE_DIR && bash infra/backup/stream.sh media" > "$MEDIA_ENC.partial" \
  || { rm -f "$MEDIA_ENC.partial" "$DUMP_ENC"; fail "Снимок фотографий не удался"; }
mv "$MEDIA_ENC.partial" "$MEDIA_ENC"
ok "снято в $DIR"

for f in "$DUMP_ENC" "$MEDIA_ENC"; do
  openssl smime -decrypt -binary -inform DER -in "$f" -inkey "$KEY" -out "${f%.enc}"
done
DUMP="${DUMP_ENC%.enc}"
MEDIA="${MEDIA_ENC%.enc}"
ok "расшифровано: $(basename "$DUMP"), $(basename "$MEDIA")"

# Зашифрованные копии остаются в DIR намеренно: переезд заодно даёт
# проверяемый бэкап старого сервера, и выбрасывать его рано.

# ---------------------------------------------------------------------------
step "2/7 Конфигурация"
# ---------------------------------------------------------------------------
scp -q "$FROM:$REMOTE_DIR/.env" "$DIR/env.from-old"
chmod 600 "$DIR/env.from-old"

IMAGE_PREFIX="$(grep -E '^IMAGE_PREFIX=' "$DIR/env.from-old" | tail -1 | cut -d= -f2-)"
IMAGE_TAG="$(grep -E '^IMAGE_TAG=' "$DIR/env.from-old" | tail -1 | cut -d= -f2-)"
IMAGE_PREFIX="${IMAGE_PREFIX:-noova}"
[ -n "$IMAGE_TAG" ] || fail "В .env старого сервера нет IMAGE_TAG"
ok "образы: $IMAGE_PREFIX/{api,web}:$IMAGE_TAG"

$SSH "$TO" "mkdir -p $REMOTE_DIR/backups"
scp -q "$DIR/env.from-old" "$TO:$REMOTE_DIR/.env"
$SSH "$TO" "chmod 600 $REMOTE_DIR/.env"
ok ".env перенесён целиком"

# ---------------------------------------------------------------------------
step "3/7 Файлы стека"
# ---------------------------------------------------------------------------
$SSH "$TO" "mkdir -p $REMOTE_DIR/infra/caddy $REMOTE_DIR/infra/backup"
scp -q docker-compose.yml "$TO:$REMOTE_DIR/"
scp -q infra/caddy/Caddyfile "$TO:$REMOTE_DIR/infra/caddy/"
scp -q infra/backup/*.sh "$TO:$REMOTE_DIR/infra/backup/"
$SSH "$TO" "chmod +x $REMOTE_DIR/infra/backup/*.sh"
ok "compose, Caddyfile, скрипты бэкапа"

# ---------------------------------------------------------------------------
step "4/7 Перенос образов"
# ---------------------------------------------------------------------------
# Поток идёт через эту машину: старый сервер и новый друг о друге не знают и
# ключей друг друга не имеют. Пересборки нет — на новой машине окажется тот
# же образ, что работал на старой.
for img in api web; do
  printf '  %s/%s:%s … ' "$IMAGE_PREFIX" "$img" "$IMAGE_TAG"
  $SSH "$FROM" "docker save $IMAGE_PREFIX/$img:$IMAGE_TAG | gzip -1" \
    | $SSH "$TO" "gunzip | docker load" >/dev/null
  printf 'перенесён\n'
done

# ---------------------------------------------------------------------------
step "5/7 Хранилища"
# ---------------------------------------------------------------------------
# Поднимаем только базу и хранилище файлов. Полный стек нельзя: `migrate`
# накатил бы схему, `api` начал бы писать — и всё это легло бы под дамп,
# который мы через минуту развернём поверх.
$SSH "$TO" "cd $REMOTE_DIR && docker compose up -d postgres minio"
printf '  жду готовности'
for _ in $(seq 1 30); do
  if $SSH "$TO" "cd $REMOTE_DIR && docker compose ps postgres --format '{{.Status}}' | grep -q healthy"; then
    printf ' готово\n'; break
  fi
  printf '.'; sleep 3
done

scp -q "$DUMP" "$TO:$REMOTE_DIR/backups/"
scp -q "$MEDIA" "$TO:$REMOTE_DIR/"
ok "данные на месте"

# ---------------------------------------------------------------------------
step "6/7 Восстановление"
# ---------------------------------------------------------------------------
printf '\033[33m'
printf 'Сейчас содержимое базы и хранилища на %s будет заменено снимком с %s.\n' "$TO" "$FROM"
printf '  дамп:        %s\n' "$(basename "$DUMP")"
printf '  фотографии:  %s\n' "$(basename "$MEDIA")"
printf '\033[0m'
printf 'Продолжить? [yes/NO] '
read -r answer </dev/tty
[ "$answer" = "yes" ] || fail "Отменено. Старый сервер не тронут, новый остался пустым."

$SSH "$TO" "cd $REMOTE_DIR && printf 'yes\n' | docker compose exec -T postgres /bin/sh /scripts/restore.sh /backups/$(basename "$DUMP")"
ok "база"
$SSH "$TO" "cd $REMOTE_DIR && printf 'yes\n' | ./infra/backup/restore-media.sh $(basename "$MEDIA")"
ok "фотографии"

# ---------------------------------------------------------------------------
step "7/7 Запуск"
# ---------------------------------------------------------------------------
$SSH "$TO" "cd $REMOTE_DIR && docker compose up -d --no-build"
$SSH "$TO" "cd $REMOTE_DIR && docker compose ps --format 'table {{.Service}}\t{{.Status}}'"

if [ -n "$RELAY" ]; then
  # Адрес берём из строки подключения, а не из TO: там может стоять алиас
  # из ~/.ssh/config, а ufw нужен именно IP.
  NEW_IP="$($SSH "$TO" "curl -fsS --max-time 10 https://api.ipify.org" 2>/dev/null || true)"
  if [ -n "$NEW_IP" ]; then
    $SSH "$RELAY" "sudo ufw allow from $NEW_IP to any port 587 proto tcp" >/dev/null
    ok "релей пропускает $NEW_IP"
  else
    warn "не удалось определить внешний IP нового сервера — откройте 587 на релее вручную"
  fi
fi

# ---------------------------------------------------------------------------
printf '\n\033[32m✓ Новый сервер поднят и работает на старых данных\033[0m\n\n'
cat <<TXT
Дальше — вручную, и это намеренно: следующий шаг необратим.

  1. Проверить новый сервер, пока DNS ещё смотрит на старый:
       ssh $TO 'cd $REMOTE_DIR && docker compose logs -f api'
       curl -H 'Host: <домен>' http://$([ -n "${NEW_IP:-}" ] && echo "$NEW_IP" || echo '<новый IP>')/healthz

  2. Переключить A-запись домена на новый IP. TTL стоило снизить заранее.

  3. Дождаться сертификата и проверить снаружи:
       curl -I https://<домен>

  4. Отправить письмо (сброс пароля) и убедиться, что оно уходит через релей.

  5. Через сутки-двое закрыть старый адрес на релее:
       ssh ${RELAY:-<релей>} 'sudo ufw status numbered'   # найти номер правила
       ssh ${RELAY:-<релей>} 'sudo ufw delete <номер>'

  6. Погасить старый сервер. Не удалять, пока не пройдёт неделя.

Копии старого сервера остались в $DIR — не удаляйте до конца переезда.
TXT
