#!/usr/bin/env bash
#
# Режим восстановления Stalwart одной командой. Запускается НА РЕЛЕЕ, из
# каталога с docker-compose.yml (~/relay).
#
#   ./recovery.sh plan                      накатить stalwart/plan.ndjson
#   ./recovery.sh cli query Application     одна команда stalwart-cli
#   ./recovery.sh apply < файл.ndjson       накатить записи из stdin
#   ./recovery.sh shell                     оболочка с настроенным stalwart-cli:
#                                           несколько команд за одну остановку
#
# Зачем скрипт, а не команды из инструкции. Режим восстановления — это второй
# контейнер на месте основного: почта на это время остановлена. Руками это
# восемь команд, и забытая последняя оставляет временный контейнер жить: он
# держит адрес основного в сети, и почта не поднимается вовсе («Address
# already in use», 16 ноября 2026). Здесь уборка и возврат почты выполняются
# всегда — при успехе, при ошибке и при Ctrl+C.
#
# Пароль восстановления одноразовый: создаётся на этот запуск, живёт в
# переменной окружения и во временном контейнере, который тут же удаляется.
# Постоянный пароль восстановления был бы чёрным ходом в обход всех учёток.
set -euo pipefail

NAME=stalwart-apply
URL=http://127.0.0.1:8080
CLI=./stalwart-cli

say() { printf '\033[36m▸ %s\033[0m\n' "$1" >&2; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

MODE="${1:-}"
case "$MODE" in
	plan | apply | cli | shell) shift ;;
	*) fail "Использование: ./recovery.sh plan | apply < файл.ndjson | cli <аргументы stalwart-cli> | shell" ;;
esac

[ -f docker-compose.yml ] || fail "Запускать из каталога релея (здесь нет docker-compose.yml)"
[ -x "$CLI" ] || fail "Нет $CLI — см. «Первый запуск», шаг 3, в documentation/deploy/smtp.md"
if [ "$MODE" = plan ]; then
	[ -f stalwart/plan.ndjson ] || fail "Нет stalwart/plan.ndjson"
	[ -f .env ] || fail "Нет .env с RELAY_PASSWORD"
fi

# Остаток прошлого запуска мешал бы и этому, и возврату почты.
docker rm -f "$NAME" >/dev/null 2>&1 || true

restore() {
	local code=$?
	trap - EXIT INT TERM
	docker rm -f "$NAME" >/dev/null 2>&1 || true
	say "Возвращаю почту"
	if docker compose up -d stalwart >&2; then
		say "Stalwart запущен. Проверка: docker compose ps stalwart"
	else
		printf '\033[31m✗ ПОЧТА НЕ ПОДНЯЛАСЬ. Вручную: docker rm -f %s; docker compose up -d stalwart\033[0m\n' "$NAME" >&2
		code=1
	fi
	exit "$code"
}
trap restore EXIT INT TERM

say "Останавливаю почту (около минуты)"
docker compose stop stalwart >&2

PASS="$(openssl rand -hex 24)"
docker compose run -d --no-deps --name "$NAME" -p 127.0.0.1:8080:8080 \
	-e STALWART_RECOVERY_MODE=1 -e STALWART_RECOVERY_ADMIN="admin:$PASS" stalwart >/dev/null

say "Жду готовности режима восстановления"
READY=0
for _ in $(seq 1 60); do
	if curl -fs "$URL/healthz/ready" >/dev/null 2>&1; then READY=1; break; fi
	sleep 2
done
[ "$READY" = 1 ] || fail "Режим восстановления не поднялся за две минуты: docker logs $NAME"

export STALWART_URL="$URL" STALWART_USER=admin STALWART_PASSWORD="$PASS"

case "$MODE" in
	plan)
		say "Накатываю stalwart/plan.ndjson"
		# Пароль релея подставляется на лету: в репозитории его нет.
		RELAY_PASSWORD="$(sed -n 's/^RELAY_PASSWORD=//p' .env)"
		[ -n "$RELAY_PASSWORD" ] || fail "В .env пуст RELAY_PASSWORD"
		sed "s/__RELAY_PASSWORD__/$RELAY_PASSWORD/" stalwart/plan.ndjson | "$CLI" apply --stdin
		;;
	apply)
		say "Накатываю записи из stdin"
		"$CLI" apply --stdin
		;;
	cli)
		"$CLI" "$@"
		;;
	shell)
		say "Оболочка режима восстановления. ./stalwart-cli уже настроен; выход — exit, почта вернётся сама"
		# Ошибка последней команды в оболочке — не повод считать запуск неудачным.
		bash --norc -i || true
		;;
esac
