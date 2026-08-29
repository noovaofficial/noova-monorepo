# Короткие команды для типовых операций. Всё то же доступно через pnpm/docker.
.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help setup dev infra-up infra-down db-migrate db-seed db-seed-reference db-reset \
        server-setup server-env update \
        reference-from-dev reference-from-server reference-to-server backup-key backup-snapshot backup-fetch backup-open backup-verify restore-media \
        build lint typecheck stack-up stack-down stack-logs backup restore \
        deploy rollback migrate-server

help: ## Показать список команд
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Первичная настройка: зависимости, инфраструктура, миграции, демо-данные
	pnpm install
	cp -n .env.example .env || true
	docker compose -f docker-compose.dev.yml up -d
	@echo "Ждём готовности Postgres…"
	@until docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U noova >/dev/null 2>&1; do sleep 1; done
	pnpm db:generate
	pnpm db:migrate
	pnpm db:seed:reference
	pnpm db:seed
	@echo "Готово. Запуск: make dev"

dev: ## Запустить web и api в режиме разработки
	pnpm dev

infra-up: ## Поднять Postgres, Redis, MinIO
	docker compose -f docker-compose.dev.yml up -d

infra-down: ## Остановить инфраструктуру разработки
	docker compose -f docker-compose.dev.yml down

db-migrate: ## Применить миграции
	pnpm db:migrate

db-seed: ## Загрузить демо-данные (требует справочников — см. db-seed-reference)
	pnpm db:seed

db-seed-reference: ## Справочники: услуги, города, районы. Идемпотентно, годится для прода
	pnpm db:seed:reference

db-reset: ## Пересоздать БД с нуля (данные будут потеряны)
	pnpm --filter @noova/api exec prisma migrate reset

build: ## Собрать все пакеты
	pnpm build

lint: ## Проверить код Biome
	pnpm lint

typecheck: ## Проверить типы во всех пакетах
	pnpm typecheck

stack-up: ## Поднять полный стек в контейнерах (прод-режим)
	docker compose up -d --build

stack-down: ## Остановить полный стек
	docker compose down

stack-logs: ## Логи полного стека
	docker compose logs -f

images: ## Собрать образы api и web (IMAGE_PREFIX=ghcr.io/<user> IMAGE_TAG=<sha>)
	docker compose build api web

images-push: images ## Собрать и отправить образы в реестр
	docker compose push api web

# Перенос образов без реестра: поток идёт по ssh, посредников нет.
# Медленнее pull, но не требует ни учётной записи, ни публикации образов.
images-ship: images ## Отправить образы прямо на сервер по ssh (SERVER=user@host)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=user@host"; exit 1)
	docker save $${IMAGE_PREFIX:-noova}/api:$${IMAGE_TAG:-latest} \
	            $${IMAGE_PREFIX:-noova}/web:$${IMAGE_TAG:-latest} \
	  | gzip | ssh $(SERVER) 'gunzip | docker load'

# --- Новый сервер -----------------------------------------------------------
# Порядок: ssh-copy-id вручную → server-setup → server-env → deploy.
# Первый шаг руками намеренно: без ключа root скрипт откажется закрывать
# парольный вход, и это правильно — иначе машина закроется снаружи.

server-setup: ## Подготовить чистый сервер: пользователь, SSH, Docker, ufw, своп (SERVER=root@host)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=root@host"; exit 1)
	ssh $(SERVER) 'bash -s' < infra/server/setup.sh

server-env: ## Создать .env на сервере (SERVER=deploy@host DOMAIN=noova.cc EMAIL=admin@…)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=deploy@host"; exit 1)
	@test -n "$(DOMAIN)" || (echo "Укажите DOMAIN=noova.cc — без схемы"; exit 1)
	@test -n "$(EMAIL)" || (echo "Укажите EMAIL=admin@… — для писем Let's Encrypt"; exit 1)
	ssh $(SERVER) 'bash -s' -- '$(DOMAIN)' '$(EMAIL)' < infra/server/make-env.sh

# Применить то, что уже лежит на сервере: правку .env, новый Caddyfile,
# изменения в compose. Образы не собираются и не везутся — для этого deploy.
update: ## Перезапустить стек из текущих образов (SERVER=deploy@host)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=deploy@host"; exit 1)
	ssh $(SERVER) 'cd noova && bash -s' < scripts/update.sh

deploy-files: ## Скопировать на сервер файлы, которые не входят в образы
	@test -n "$(SERVER)" || (echo "Укажите SERVER=user@host"; exit 1)
	ssh $(SERVER) 'mkdir -p noova/infra/caddy noova/infra/backup'
	scp docker-compose.yml $(SERVER):noova/
	scp infra/caddy/Caddyfile $(SERVER):noova/infra/caddy/
	scp infra/backup/*.sh $(SERVER):noova/infra/backup/

# Полный выпуск одной командой. Отдельные шаги выше остаются: они нужны,
# когда что-то пошло не так и цепочку надо разобрать на части.
deploy: ## Выпуск на сервер целиком: сборка, перенос, запуск, проверка (SERVER=user@host)
	@SERVER=$(SERVER) ./scripts/deploy.sh

migrate-server: ## Переезд на другую машину (FROM=deploy@old TO=deploy@new KEY=… [RELAY=…])
	@test -n "$(FROM)" || (echo "Укажите FROM=deploy@старый"; exit 1)
	@test -n "$(TO)" || (echo "Укажите TO=deploy@новый"; exit 1)
	@test -n "$(KEY)" || (echo "Укажите KEY=путь к закрытому ключу бэкапов"; exit 1)
	FROM='$(FROM)' TO='$(TO)' KEY='$(KEY)' RELAY='$(RELAY)' DIR='$(DIR)' ./scripts/migrate-server.sh

rollback: ## Вернуть прежний образ без миграций (SERVER=user@host TAG=<тег>)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=user@host"; exit 1)
	@test -n "$(TAG)" || (echo "Укажите TAG=<тег прошлого выпуска>"; exit 1)
	ssh $(SERVER) 'cd $${REMOTE_DIR:-noova} \
	  && sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$(TAG)|" .env \
	  && docker compose up -d --no-build && docker compose ps'

jobs: ## Прогнать чистку по срокам хранения прямо сейчас (локально)
	pnpm --filter @noova/api jobs:dev

# --- Резервные копии (N-29) -------------------------------------------------

# --- Справочник: три направления ------------------------------------------
# Файл apps/api/prisma/reference-data.json — общий формат для всех трёх.
# Правило: у справочника один источник правды за раз. Выгрузка со стенда и
# с прода пишут в один файл, и попеременное использование даст пинг-понг
# идентификаторов в git.

reference-from-dev: ## Локальная база → файл в репозитории
	pnpm --filter @noova/api db:export:reference

reference-from-server: ## Сервер → файл в репозитории (SERVER=deploy@host)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=deploy@host"; exit 1)
	./scripts/reference-pull.sh '$(SERVER)'

reference-to-server: ## Файл из репозитория → сервер, с накатом (SERVER=deploy@host)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=deploy@host"; exit 1)
	./scripts/reference-push.sh '$(SERVER)'

backup-key: ## Создать пару ключей для шифрования копий (DIR=~/noova-backup)
	@test -n "$(DIR)" || (echo "Укажите DIR=~/noova-backup"; exit 1)
	./infra/backup/make-key.sh '$(DIR)'

backup-snapshot: ## Снимок на сервере: база + фотографии, зашифровано (SERVER=deploy@host)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=deploy@host"; exit 1)
	ssh $(SERVER) 'cd noova && bash -s' < infra/backup/snapshot.sh

backup-fetch: backup-snapshot ## Снять копию и забрать её к себе (SERVER=… DIR=куда)
	@test -n "$(DIR)" || (echo "Укажите DIR=куда сложить"; exit 1)
	mkdir -p '$(DIR)'
	scp $(SERVER):noova/backups/'*.enc' '$(DIR)/'
	@echo "Забрано в $(DIR). Расшифровать: make backup-open FILE=… KEY=…"

backup-open: ## Расшифровать копию (FILE=…​.enc KEY=~/noova-backup/backup-private.pem)
	@test -n "$(FILE)" || (echo "Укажите FILE=путь.enc"; exit 1)
	@test -n "$(KEY)" || (echo "Укажите KEY=путь к закрытому ключу"; exit 1)
	openssl smime -decrypt -binary -inform DER -in '$(FILE)' -inkey '$(KEY)' -out '$(FILE:.enc=)'
	@echo "Расшифровано: $(FILE:.enc=)"

backup-verify: ## Проверить копию восстановлением в отдельную БД (FILE=…​.sql.gz)
	@test -n "$(FILE)" || (echo "Укажите FILE=путь к расшифрованному дампу"; exit 1)
	./infra/backup/verify.sh '$(FILE)'

backup: ## Сделать дамп БД прямо сейчас
	docker compose exec -T backup /bin/sh /scripts/backup.sh

restore: ## Восстановить из дампа: make restore DUMP=backups/noova-<stamp>.sql.gz
	@test -n "$(DUMP)" || (echo "Укажите DUMP=путь"; exit 1)
	docker compose exec -T postgres /bin/sh /scripts/restore.sh /$(DUMP)

restore-media: ## Восстановить фотографии: make restore-media ARCHIVE=noova-media-<stamp>.tar.gz
	@test -n "$(ARCHIVE)" || (echo "Укажите ARCHIVE=путь"; exit 1)
	./infra/backup/restore-media.sh '$(ARCHIVE)'
