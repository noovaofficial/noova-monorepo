# Короткие команды для типовых операций. Всё то же доступно через pnpm/docker.
.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help setup dev infra-up infra-down db-migrate db-seed db-reset \
        build lint typecheck stack-up stack-down stack-logs backup restore \
        deploy rollback

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

db-seed: ## Загрузить демо-данные
	pnpm db:seed

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

rollback: ## Вернуть прежний образ без миграций (SERVER=user@host TAG=<тег>)
	@test -n "$(SERVER)" || (echo "Укажите SERVER=user@host"; exit 1)
	@test -n "$(TAG)" || (echo "Укажите TAG=<тег прошлого выпуска>"; exit 1)
	ssh $(SERVER) 'cd $${REMOTE_DIR:-noova} \
	  && sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$(TAG)|" .env \
	  && docker compose up -d --no-build && docker compose ps'

jobs: ## Прогнать чистку по срокам хранения прямо сейчас (локально)
	pnpm --filter @noova/api jobs:dev

backup: ## Сделать дамп БД прямо сейчас
	docker compose exec -T backup /bin/sh /scripts/backup.sh

restore: ## Восстановить из дампа: make restore DUMP=backups/noova-<stamp>.sql.gz
	@test -n "$(DUMP)" || (echo "Укажите DUMP=путь"; exit 1)
	docker compose exec -T postgres /bin/sh /scripts/restore.sh /$(DUMP)
