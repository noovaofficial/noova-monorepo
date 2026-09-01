#!/usr/bin/env bash
#
# Один зашифрованный поток резервной копии в stdout. Запускается НА СЕРВЕРЕ,
# из каталога стека. На диск сервера не пишет ничего.
#
#   bash infra/backup/stream.sh db      > копия.sql.gz.enc
#   bash infra/backup/stream.sh media   > фото.tar.gz.enc
#
# Почему потоком, а не файлом. Копий на прод-сервере быть не должно: машина
# смотрит наружу, а дамп — это вся база персональных данных особой категории.
# Раньше снимок ложился в ./backups и ждал, пока его заберут; теперь он
# нигде не задерживается — данные идут от pg_dump сразу в ssh.
#
# Побочно это снимает и проблему с памятью: `openssl smime -encrypt -in файл`
# держит в памяти вдвое больше размера входа (замерено: 787 МБ на 382 МБ), и
# на большом архиве фотографий сервер это убило бы. Ключ -stream делает шифрование
# потоковым — расход постоянный, около 6 МБ.
#
# Шифрует хост, а не контейнер: в postgres:17-alpine нет ни openssl, ни age,
# ни gpg, а ставить их при старте контейнера значит поставить бэкапы в
# зависимость от сети в момент запуска.
#
# ВАЖНО: в stdout идут только байты копии. Всё остальное — в stderr, иначе
# первое же предупреждение docker окажется внутри зашифрованного файла.
set -euo pipefail

WHAT="${1:-}"
DIR="${NOOVA_DIR:-$HOME/noova}"
KEY="${BACKUP_PUBLIC_KEY:-$DIR/backup-public.pem}"

fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

cd "$DIR" || fail "Нет каталога $DIR"
[ -f "$KEY" ] || fail "Нет открытого ключа $KEY.
  Создайте пару у себя: ./infra/backup/make-key.sh ~/noova-backup
  и привезите открытую часть: scp backup-public.pem deploy@<IP>:noova/"

# -stream обязателен: без него openssl буферизует весь вход в память.
encrypt() { openssl smime -encrypt -binary -aes-256-cbc -stream -outform DER "$KEY"; }

case "$WHAT" in
	db)
		# Пользователя и базу берём из окружения контейнера, чтобы пароли и
		# имена не появлялись в командной строке и в логах ssh.
		docker compose exec -T postgres sh -c \
			'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=plain --no-owner --no-acl --clean --if-exists' \
			</dev/null | gzip -9 | encrypt
		;;
	media)
		# Имя тома спрашиваем у Docker, а не вычитываем из compose-файла: там
		# короткое имя (`minio_data`), а Docker хранит его с префиксом проекта
		# (`noova_minio_data`). Разбор регуляркой давал первое и промахивался.
		CID="$(docker compose ps -q minio 2>/dev/null || true)"
		VOLUME=""
		if [ -n "$CID" ]; then
			VOLUME="$(docker inspect "$CID" \
				--format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
		fi
		# Контейнер может быть погашен — тогда ищем том по имени.
		[ -n "$VOLUME" ] || VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_minio_data$' | head -1)"
		[ -n "$VOLUME" ] || fail "Не нашёл том с фотографиями.
  Посмотреть, какие есть: docker volume ls | grep minio"
		printf 'том: %s\n' "$VOLUME" >&2
		docker run --rm -v "$VOLUME":/data:ro postgres:17-alpine tar cz -C /data . \
			</dev/null | encrypt
		;;
	*)
		fail "Использование: stream.sh db|media"
		;;
esac
