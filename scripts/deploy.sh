#!/usr/bin/env bash
#
# Выпуск на сервер одной командой: сборка → перенос → запуск → проверка.
#
#   make deploy SERVER=deploy@1.2.3.4
#
# Что здесь есть такого, чего нет в связке `images-ship` + `deploy-files`.
#
# 1. Тег по коммиту вместо `latest`. `latest` не даёт ответить на вопрос
#    «что сейчас запущено» и превращает откат в гадание.
# 2. Проверки до сборки. Публичные адреса запекаются в браузерный бандл
#    на этапе сборки: собрать с localhost в SITE_URL — значит выпустить
#    неработающий фронт и узнать об этом уже на сервере.
# 3. Дамп базы перед миграциями. `prisma migrate deploy` необратим, и это
#    единственный способ вернуться.
# 4. Ожидание healthcheck. Без него скрипт «успешно» завершается на стеке,
#    который в этот момент падает в рестарт-цикле.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVER="${SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-noova}"
IMAGE_PREFIX="${IMAGE_PREFIX:-noova}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

step() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$SERVER" ] || fail "Укажите SERVER=user@host"

# ---------------------------------------------------------------------------
# Тег выпуска
# ---------------------------------------------------------------------------
if [ -z "${IMAGE_TAG:-}" ]; then
  IMAGE_TAG="$(git rev-parse --short HEAD)"
  # Незакоммиченные правки попадают в образ, но не в историю. Пометка в теге
  # не даёт потом принять такой образ за содержимое коммита.
  if [ -n "$(git status --porcelain)" ]; then
    IMAGE_TAG="${IMAGE_TAG}-dirty"
    printf '\033[33m! Рабочее дерево грязное — тег %s\033[0m\n' "$IMAGE_TAG"
  fi
fi
export IMAGE_PREFIX IMAGE_TAG

# ---------------------------------------------------------------------------
# Проверки до сборки: дешевле упасть здесь, чем на сервере
# ---------------------------------------------------------------------------
# Соединение с сервером рвётся: выпуск дважды обрывался между переносом
# образов и запуском, оставляя на машине новые образы и прежний IMAGE_TAG.
# Снаружи это выглядело как успешный выпуск, в котором «нет изменений».
#
# Повтор вместо разбирательства: обрыв здесь — свойство канала, а не ошибка
# в командах. Три попытки с паузой, дальше — честное падение.
retry() {
  local attempt=1
  until "$@"; do
    if [ "$attempt" -ge 3 ]; then
      fail "Не удалось выполнить после 3 попыток: $*"
    fi
    printf '\033[33m  ! попытка %s не удалась, повтор через %ss\033[0m\n' "$attempt" "$((attempt * 3))"
    sleep "$((attempt * 3))"
    attempt=$((attempt + 1))
  done
}

step "Проверки"

# Локальный .env держит адреса разработки, и переписывать его на время
# выпуска — верный способ однажды собрать прод с localhost. Поэтому продовые
# адреса живут отдельно: .env.deploy, если он есть, перекрывает .env.
ENV_FILE=".env"
[ -f .env.deploy ] && ENV_FILE=".env.deploy"
[ -f "$ENV_FILE" ] || fail "Нет ни .env.deploy, ни .env — неоткуда взять SITE_URL и PUBLIC_API_URL."

# `|| true` не украшение: при pipefail отсутствие строки в файле роняло бы
# скрипт молча, ещё до понятного сообщения ниже.
read_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'" || true; }
SITE_URL="${SITE_URL:-$(read_env SITE_URL)}"
PUBLIC_API_URL="${PUBLIC_API_URL:-$(read_env PUBLIC_API_URL)}"

for pair in "SITE_URL=$SITE_URL" "PUBLIC_API_URL=$PUBLIC_API_URL"; do
  name="${pair%%=*}"; value="${pair#*=}"
  [ -n "$value" ] || fail "$name не задан в $ENV_FILE — он запечётся в бандл пустым. См. release.md §1."
  case "$value" in
    *localhost*|*127.0.0.1*)
      fail "$name = $value. Это уедет в браузерный бандл и не чинится переменными на сервере — только пересборкой." ;;
    https://*) ;;
    *) fail "$name = $value. Ожидается https:// — иначе браузер заблокирует запросы со страницы по TLS." ;;
  esac
done

# Один канал на весь выпуск. Причина: доступ к 22 порту ограничен по частоте
# новых подключений — не в sshd (там всё по умолчанию), а правилом firewall
# или сетью провайдера. Выпуск же открывает их около десятка за минуту:
# проверка доступа, .env, uname, перенос образов, три scp, дамп, запуск. На
# пятом-шестом сервер начинает закрывать соединения, и выпуск падает
# посередине — как раз тот обрыв «между переносом и запуском», ради которого
# ниже написан retry().
#
# ControlMaster сводит их к одному TCP-соединению: остальные идут внутри него
# и мимо ограничителя. Побочно выпуск становится заметно быстрее — не нужно
# каждый раз заново договариваться о шифровании.
#
# Функции с именами ssh и scp, а не отдельные обёртки: так мультиплексирование
# получают все вызовы в скрипте, включая те, что появятся позже. `command`
# обязателен — иначе функция вызовет сама себя.
# Каталог короткий и явно в /tmp: путь к управляющему сокету ограничен
# 104 байтами (длина sun_path), а `mktemp -d` без шаблона на macOS отдаёт
# что-то вроде /var/folders/0t/fyvwwl.../T/tmp.XXXX — вместе с 40-символьным
# хешем %C это уже за пределом, и ssh отказывается наотрез.
SSH_CTL_DIR="$(mktemp -d /tmp/noova-mux-XXXXXX)"
SSH_MUX=(-o ControlMaster=auto -o "ControlPath=$SSH_CTL_DIR/%C" -o ControlPersist=120
         -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
ssh() { command ssh "${SSH_MUX[@]}" "$@"; }
scp() { command scp "${SSH_MUX[@]}" "$@"; }
# Канал закрываем сами: без этого он проживёт ControlPersist секунд после
# выхода и будет держать сокет во временном каталоге, который мы удаляем.
close_mux() {
  command ssh "${SSH_MUX[@]}" -O exit "$SERVER" 2>/dev/null || true
  rm -rf "$SSH_CTL_DIR"
}
trap close_mux EXIT

ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" true \
  || fail "Нет доступа по ssh к $SERVER (нужен ключ без пароля)."

# Секреты скрипт не создаёт и не копирует: их заводят на сервере осознанно,
# один раз. Всё остальное он привезёт сам.
ssh "$SERVER" "test -f $REMOTE_DIR/.env" \
  || fail "На сервере нет $REMOTE_DIR/.env. Первый раз: ssh $SERVER 'mkdir -p $REMOTE_DIR && nano $REMOTE_DIR/.env' — по таблице из release.md §1."

# Архитектура. Собирать на Apple Silicon и везти на x86-сервер — значит
# получить контейнеры, падающие с `exec format error`: Docker по умолчанию
# собирает под хозяйскую платформу и молча, поэтому спрашиваем сервер.
arch_to_platform() {
  case "$1" in
    x86_64|amd64)  echo linux/amd64 ;;
    aarch64|arm64) echo linux/arm64 ;;
    *)             echo "" ;;
  esac
}
REMOTE_ARCH="$(ssh "$SERVER" 'uname -m' 2>/dev/null || true)"
TARGET_PLATFORM="$(arch_to_platform "$REMOTE_ARCH")"
[ -n "$TARGET_PLATFORM" ] || fail "Не понял архитектуру сервера: uname -m вернул '$REMOTE_ARCH'."
LOCAL_PLATFORM="$(arch_to_platform "$(docker info --format '{{.Architecture}}' 2>/dev/null || true)")"
export DOCKER_DEFAULT_PLATFORM="$TARGET_PLATFORM"

echo "Сервер:  $SERVER:$REMOTE_DIR"
echo "Образы:  $IMAGE_PREFIX/{api,web}:$IMAGE_TAG"
echo "Домен:   $SITE_URL (из $ENV_FILE)"
echo "Платформа: $TARGET_PLATFORM (сервер: $REMOTE_ARCH)"

if [ "$LOCAL_PLATFORM" != "$TARGET_PLATFORM" ]; then
  printf '\033[33m! Сборка под чужую платформу через эмуляцию — это долго (десятки минут).\n'
  printf '  Быстрее: собрать в CI на amd64 либо прямо на сервере.\033[0m\n'
fi

# Экспорт обязателен: compose подставляет их в build-аргументы web, а
# переменные окружения перекрывают значения из .env — то есть localhost
# из файла разработки сюда не просочится.
export SITE_URL PUBLIC_API_URL

# ---------------------------------------------------------------------------
# Сборка и перенос
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Тесты и типы — до сборки.
#
# Сборка под чужую платформу идёт через эмуляцию и занимает десятки минут:
# узнавать о падающем тесте после неё значит потратить их впустую. Дешёвая
# проверка должна идти первой.
#
# Линтер сюда не входит намеренно: в репозитории есть предсуществующие
# замечания, и выпуск, падающий на них, начнут обходить флагом — а вместе
# с ними станут обходить и тесты.
# ---------------------------------------------------------------------------
if [ "${SKIP_TESTS:-}" = "1" ]; then
  printf '\033[33m! Тесты пропущены (SKIP_TESTS=1)\033[0m\n'
else
  step "Типы и тесты"
  pnpm typecheck || fail "Типы не сходятся. Выпуск остановлен до сборки.
  Обойти в аварийном случае: SKIP_TESTS=1 make deploy SERVER=$SERVER"
  pnpm test || fail "Тесты не проходят. Выпуск остановлен до сборки.
  Обойти в аварийном случае: SKIP_TESTS=1 make deploy SERVER=$SERVER"
fi

step "Сборка образов"
docker compose build api web

# Проверяем результат, а не намерение: если платформа не применилась,
# узнать об этом лучше здесь, чем по «exec format error» на сервере.
for img in api web; do
  got="$(docker image inspect "$IMAGE_PREFIX/$img:$IMAGE_TAG" --format '{{.Os}}/{{.Architecture}}')"
  [ "$got" = "$TARGET_PLATFORM" ] \
    || fail "Образ $img собран под $got, а сервер — $TARGET_PLATFORM. Там он не запустится."
done

step "Перенос образов по ssh"
# Поток идёт напрямую: ни реестра, ни токена, ни промежуточного файла.
#
# Тег записывается в .env ТУТ ЖЕ, одним сеансом с загрузкой. Раньше он писался
# позже, на шаге «Запуск», и между ними оставалось окно: если связь рвалась,
# на сервере оказывались новые образы и прежний IMAGE_TAG. Снаружи это
# выглядело успешным выпуском без изменений — так дважды и вышло.
# Теперь либо доехало и то и другое, либо ничего.
docker save "$IMAGE_PREFIX/api:$IMAGE_TAG" "$IMAGE_PREFIX/web:$IMAGE_TAG" \
  | gzip | ssh "$SERVER" "gunzip | docker load \
      && cd $REMOTE_DIR \
      && (grep -qE '^IMAGE_TAG=' .env \
            && sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=$IMAGE_TAG|' .env \
            || printf '\nIMAGE_TAG=%s\n' '$IMAGE_TAG' >> .env) \
      && (grep -qE '^IMAGE_PREFIX=' .env \
            && sed -i 's|^IMAGE_PREFIX=.*|IMAGE_PREFIX=$IMAGE_PREFIX|' .env \
            || printf 'IMAGE_PREFIX=%s\n' '$IMAGE_PREFIX' >> .env)"

step "Файлы вне образов"
retry ssh "$SERVER" "mkdir -p $REMOTE_DIR/infra/caddy $REMOTE_DIR/infra/backup"
retry scp -q docker-compose.yml "$SERVER:$REMOTE_DIR/"
retry scp -q infra/caddy/Caddyfile "$SERVER:$REMOTE_DIR/infra/caddy/"
retry scp -q infra/backup/*.sh "$SERVER:$REMOTE_DIR/infra/backup/"

step "Дамп базы перед миграциями"
# Раньше дамп снимался на самом сервере, в контейнер `backup`. Теперь копий
# на сервере не держим, поэтому дамп уезжает сюда потоком. Только база:
# архив фотографий на выпуске не нужен, а весит много.
#
# Неудача здесь выпуск не останавливает: ночная копия на хранилище есть, а
# ради страховки блокировать выкладку смысла нет.
if ssh "$SERVER" "test -f $REMOTE_DIR/backup-public.pem" 2>/dev/null; then
  mkdir -p backups
  PRE="backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.enc"
  if ssh "$SERVER" "cd $REMOTE_DIR && bash infra/backup/stream.sh db" > "$PRE.partial"; then
    mv "$PRE.partial" "$PRE"
    printf '  ✓ %s\n' "$PRE"
  else
    rm -f "$PRE.partial"
    printf '\033[33m  ! дамп не снят — выпуск продолжается\033[0m\n'
  fi
else
  printf '\033[33m  ! на сервере нет backup-public.pem — дамп пропущен\033[0m\n'
fi

# ---------------------------------------------------------------------------
# Запуск. Всё, что дальше, выполняется на сервере одним сеансом: разрывать
# его на отдельные ssh-вызовы значит терять состояние между шагами.
# ---------------------------------------------------------------------------
step "Запуск"

ssh "$SERVER" bash -s -- "$REMOTE_DIR" "$IMAGE_PREFIX" "$IMAGE_TAG" "$HEALTH_TIMEOUT" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"; PREFIX="$2"; TAG="$3"; TIMEOUT="$4"
cd "$REMOTE_DIR"

PREV_TAG="$(grep -E '^IMAGE_TAG=' .env | tail -1 | cut -d= -f2- || true)"

# Тег уже записан на шаге переноса — вместе с образами, одним сеансом.
# Здесь только сверяем, что дошло ожидаемое: расхождение означает, что
# .env правили между шагами.
ACTUAL_TAG="$(grep -E '^IMAGE_TAG=' .env | tail -1 | cut -d= -f2-)"
[ "$ACTUAL_TAG" = "$TAG" ] || {
  echo "✗ В .env тег $ACTUAL_TAG, ожидался $TAG" >&2
  exit 1
}

# --no-build обязателен: исходников на сервере нет, и без флага compose
# молча попытался бы собрать образ сам.
# --remove-orphans: удалённый из compose сервис иначе продолжает работать —
# compose лишь предупреждает о нём. Так снятый контейнер `backup` ещё сутками
# писал бы дампы на диск сервера, где копий быть не должно.
docker compose up -d --no-build --remove-orphans

echo "Жду готовности api и web (до ${TIMEOUT}с)…"
deadline=$(( $(date +%s) + TIMEOUT ))
while :; do
  ok=1
  for svc in api web; do
    cid="$(docker compose ps -q "$svc" 2>/dev/null || true)"
    if [ -z "$cid" ]; then ok=0; break; fi
    state="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
    [ "$state" = healthy ] || ok=0
  done
  [ "$ok" = 1 ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "✗ Стек не поднялся за ${TIMEOUT}с." >&2
    docker compose ps >&2
    docker compose logs --tail 40 api web >&2
    # Автоматического отката нет намеренно: миграции уже применены, а
    # `migrate deploy` необратим — откатить образ на схему из прошлого
    # выпуска значит получить рассинхрон кода и базы.
    echo >&2
    echo "Откат кода (только если миграции не менялись):" >&2
    echo "  ssh <сервер> 'cd $REMOTE_DIR && sed -i \"s|^IMAGE_TAG=.*|IMAGE_TAG=${PREV_TAG}|\" .env && docker compose up -d --no-build'" >&2
    exit 1
  fi
  sleep 5
done

echo "Все healthy."
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

# Сверяем, что запущено именно то, что привезли.
#
# Выпуск может оборваться между переносом образов и этим шагом — тогда образы
# на сервере новые, а `.env` и контейнеры остаются на прежнем теге. Снаружи
# это выглядит как успешный выпуск, в котором «почему-то нет изменений»;
# ровно так один выпуск и потерялся незаметно.
for svc in api web; do
  want="$(docker image inspect "$PREFIX/$svc:$TAG" --format '{{.Id}}')"
  got="$(docker inspect "$(docker compose ps -q "$svc")" --format '{{.Image}}')"
  [ "$want" = "$got" ] || {
    echo "✗ Контейнер $svc собран не из $PREFIX/$svc:$TAG" >&2
    echo "  ожидался образ $want" >&2
    echo "  запущен образ   $got" >&2
    exit 1
  }
done
echo "Образы совпадают с выпуском $TAG."

# Справочники: услуги, города, районы. Миграции создают пустые таблицы, и без
# этого шага на чистой базе не пройти регистрацию — список городов приходит
# пустым, а панель фильтров без услуг. Идемпотентно: обновляет существующее
# и ничего не удаляет, поэтому гоняется каждый выпуск, а не только первый.
#
# ВНИМАНИЕ на будущее: как только справочники станут редактироваться из
# админки (N-32/N-35), этот шаг начнёт затирать правки администратора —
# его нужно будет убрать отсюда осознанно, а не обнаружить по потере данных.
echo "Справочники…"
docker compose exec -T api node dist/scripts/seed-reference.js </dev/null

# Образы прошлых выпусков накапливаются по гигабайту: api около 1 ГБ.
docker image prune -f >/dev/null 2>&1 || true
REMOTE

# ---------------------------------------------------------------------------
# Проверка снаружи: healthy-контейнер ещё не значит доступный сайт — между
# ними Caddy, TLS и DNS.
# ---------------------------------------------------------------------------
step "Проверка снаружи"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE_URL/healthz" || echo 000)"
if [ "$code" = 200 ]; then
  printf '\033[32m✓ %s/healthz → 200. Выпущено: %s\033[0m\n' "$SITE_URL" "$IMAGE_TAG"
else
  printf '\033[33m! %s/healthz → %s. Контейнеры здоровы, значит дело снаружи: DNS, TLS или firewall.\033[0m\n' "$SITE_URL" "$code"
  exit 1
fi
