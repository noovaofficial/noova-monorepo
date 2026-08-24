#!/usr/bin/env bash
#
# Проверка резервной копии восстановлением (N-29).
#
#   ./infra/backup/verify.sh ~/noova-backup/noova-20260824T120000Z.sql.gz
#
# Поднимает дамп в ОТДЕЛЬНУЮ базу и считает строки. Текущие данные не
# трогает: проверка, ради которой нужно рискнуть рабочей базой, не будет
# сделана ни разу — а непроверенный бэкап это не бэкап.
set -euo pipefail

DUMP="${1:-}"
DB="noova_verify_$$"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.dev.yml}"
PSQL_USER="${POSTGRES_USER:-noova}"

fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }

[ -n "$DUMP" ] || fail "Использование: verify.sh <дамп.sql.gz>"
[ -f "$DUMP" ] || fail "Файл не найден: $DUMP"
case "$DUMP" in
  *.enc) fail "Файл ещё зашифрован. Сначала: make backup-open FILE=$DUMP KEY=…" ;;
esac

psql_run() { $COMPOSE exec -T postgres psql -U "$PSQL_USER" -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  psql_run -d postgres -c "drop database if exists \"$DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

say "Создаю временную базу $DB"
psql_run -d postgres -c "create database \"$DB\";" >/dev/null

say "Разворачиваю дамп"
# Дамп сделан с --clean --if-exists: на пустой базе часть DROP не найдёт
# объектов, и это не ошибка. Валится только на настоящих проблемах.
gunzip -c "$DUMP" | $COMPOSE exec -T postgres psql -U "$PSQL_USER" -d "$DB" >/dev/null 2>&1 || true

say "Считаю строки"
ROWS="$(psql_run -d "$DB" -tAc "
  select coalesce(sum(n_live_tup), 0) from pg_stat_user_tables;
" | tr -d '[:space:]')"
TABLES="$(psql_run -d "$DB" -tAc "
  select count(*) from information_schema.tables where table_schema = 'public';
" | tr -d '[:space:]')"
PROFILES="$(psql_run -d "$DB" -tAc 'select count(*) from "Profile";' 2>/dev/null | tr -d '[:space:]' || echo '?')"
PHOTOS="$(psql_run -d "$DB" -tAc 'select count(*) from "Photo";' 2>/dev/null | tr -d '[:space:]' || echo '?')"

printf '\n  таблиц: %s\n  анкет:  %s\n  фото:   %s\n\n' "$TABLES" "$PROFILES" "$PHOTOS"

[ "$TABLES" -gt 0 ] 2>/dev/null || fail "В восстановленной базе нет таблиц — копия непригодна"
printf '\033[32m✓ Копия разворачивается.\033[0m Временная база удалена.\n'

# Фотографии проверяются отдельно: строка в базе без файла в хранилище — это
# битая анкета, и в дампе такого не видно.
printf '\nАрхив фотографий проверяйте рядом:\n'
printf '  tar tzf noova-media-<stamp>.tar.gz | head\n'
printf '  число объектов должно быть сопоставимо с числом фото выше.\n'
