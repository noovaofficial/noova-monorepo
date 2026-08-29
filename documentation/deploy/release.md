# Выпуск

```bash
make deploy SERVER=deploy@<IP>
```

Машина должна быть подготовлена — [server.md](server.md).

---

## 1. `.env`

Файлов два, и это разные файлы.

| Файл | Где | Что в нём |
|---|---|---|
| `.env` | ваша машина | разработка, `pnpm dev`. Для выпуска не используется |
| `.env.deploy` | ваша машина | **две** строки: продовые `SITE_URL`, `PUBLIC_API_URL` |
| `.env` | сервер, `~/noova/` | вся продовая конфигурация и секреты |

**Локально:**

```bash
cat > .env.deploy <<'EOF'
SITE_URL=https://noova.cc
PUBLIC_API_URL=https://noova.cc
EOF
```

Только эти две запекаются в браузерный бандл. Предупреждение сборки про
неустановленные `MINIO_ROOT_USER`, `SITE_DOMAIN` и прочие — ожидаемо.

**На сервере:**

```bash
make server-env SERVER=deploy@<IP> DOMAIN=noova.cc EMAIL=admin@example.com
```

Существующий файл не перезаписывается: смена `POSTGRES_PASSWORD` оставила бы
базу недоступной.

> Держите копию `.env` вне сервера. Без `POSTGRES_PASSWORD` дамп не восстановить.

### Обязательные переменные

Значений по умолчанию нет, пустыми ломают стек.

| Переменная | Что ставить |
|---|---|
| `SITE_DOMAIN` | `noova.cc` — без схемы |
| `SITE_URL` / `PUBLIC_API_URL` | `https://noova.cc` |
| `MEDIA_BASE_URL` | `https://noova.cc/media` |
| `ACME_EMAIL` | ваш адрес — туда письма об истечении сертификата |
| `POSTGRES_USER` / `POSTGRES_DB` | `noova` |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32 \| tr -d '/+='` |
| `MINIO_ROOT_USER` | любое имя, не `noova` |
| `MINIO_ROOT_PASSWORD` | `openssl rand -base64 32` |
| `IP_HASH_SALT` | `openssl rand -hex 32` |
| `REVALIDATE_SECRET` | `openssl rand -hex 32` |
| `INTERNAL_API_TOKEN` | `openssl rand -hex 32` |
| `MAIL_DOMAIN` | `noova.cc` |
| `MAIL_FROM` | `"Noova <noreply@noova.cc>"` |

`tr -d '/+='` обязателен: пароль Postgres уходит в строку подключения.

**Три последних секрета обязаны быть случайными.** По `IP_HASH_SALT` адреса
восстанавливаются из журналов, по `INTERNAL_API_TOKEN` снимается лимит
запросов, по `REVALIDATE_SECRET` сбрасывается кэш в цикле.

### `RELAY_*` — внешний релей

Только когда почта уходит через вторую машину, [mail.md](mail.md).

| Переменная | Пример |
|---|---|
| `RELAY_HOST` | `[mail.noova.cc]:587` — скобки обязательны, имя, не IP |
| `RELAY_USER` | `noreply@noova.cc` — обязан совпадать с адресом в `MAIL_FROM` |
| `RELAY_PASSWORD` | пароль SMTP-учётки релея |
| `RELAY_TLS_LEVEL` | `encrypt` |

Пустые = отправка напрямую.

### Чего в серверном `.env` быть не должно

> **`SMTP_*`.** Compose берёт их из `.env`, если есть, иначе подставляет свой
> Postfix. В `.env.example` они стоят в `localhost:1025` — это Mailpit для
> разработки. Скопируете пример целиком — API начнёт стучаться в самого себя.

**Не читаются на сервере:** `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `WEB_REVALIDATE_URL`.

**Выводятся из других:** `CORS_ORIGINS`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MEDIA_URL`.

> `NEXT_PUBLIC_MEDIA_URL` нужна **на сборке**: `next.config.ts` строит из неё
> `images.remotePatterns`. Не доехала — оптимизатор ответит `"url" parameter
> is not allowed` на каждую фотографию, лечится только пересборкой.

**С умолчаниями:** `LOG_LEVEL`, `S3_BUCKET`, `S3_REGION`, `RETENTION_*`,
`JOBS_INTERVAL_SECONDS`, `BACKUP_*`, `RATE_LIMIT_*`, `MAP_TILE_*`.

---

## 2. `make deploy`

Собирает у вас, привозит, запускает, проверяет. На сервере не нужно ни git,
ни исходников, ни учётной записи GitHub.

Сверх ручных шагов `scripts/deploy.sh` делает пять вещей:

1. **Типы и тесты до сборки** — она идёт через эмуляцию и занимает десятки
   минут. Линтер не входит намеренно. Обход: `SKIP_TESTS=1 make deploy …`.
2. **Проверки окружения** — `SITE_URL`, ssh, наличие `.env`, архитектура.
3. **Тег по коммиту**, грязное дерево получает `-dirty`. Запись тега идёт тем
   же ssh-сеансом, что и загрузка образов.
4. **Дамп базы перед миграциями** — `prisma migrate deploy` необратим.
5. **Сверка запущенного с привезённым** и запрос снаружи.

### Платформа

Образ с arm64 на x86-сервере падает с `exec format error`, причём сборка и
перенос проходят «успешно». Скрипт спрашивает `uname -m` и выставляет
`DOCKER_DEFAULT_PLATFORM`. Плата — эмуляция, десятки минут.

### Шум в логе сборки — норма

```
[api] headerCatalog недоступен, отдаём запасное значение TypeError: fetch failed
```

`next build` пререндерит 47 страниц, API в этот момент нет. Смотреть надо на
`ERROR` и `error:` от buildx.

### Порядок на сервере

Postgres/Redis/MinIO → `migrate` → `minio-init` → `api` → `web` → `caddy`.
Наружу смотрит только Caddy. Миграции идут отдельным контейнером: при
нескольких репликах `api` они подрались бы за блокировку.

### `make update`

```bash
make deploy-files SERVER=deploy@<IP>   # docker-compose.yml, Caddyfile, скрипты
make update SERVER=deploy@<IP>         # docker compose up -d --no-build
```

Для правок `.env`, `Caddyfile`, `docker-compose.yml`. Образы не пересобираются.
Код так не выкатить — нужен `make deploy`.

Отдельные шаги: `make images`, `make images-ship`, `make images-push`.

---

## 3. Справочники

```bash
ssh deploy@<IP> "cd noova && docker compose exec api node dist/scripts/seed-reference.js"
```

Идемпотентно, `make deploy` делает сам. Без городов и услуг не пройти
регистрацию.

Обратное направление — справочник живёт в базе, в репозиторий возвращается
выгрузкой:

```bash
docker compose exec api node dist/scripts/export-reference.js   # на сервере
# prisma/reference-data.ts забрать и закоммитить
```

> **Правки в админке без выгрузки живут до следующего выпуска.** `make deploy`
> накатывает справочник из файла. Порядок: поправили → выгрузили → закоммитили.

---

## 4. Первый администратор

```bash
ssh deploy@<IP> "cd noova && docker compose exec api node dist/scripts/create-admin.js <email> '<пароль>'"
```

Разово. Пароль не короче 10 символов. Повторный запуск на существующем адресе
завершится ошибкой.

---

## 5. Если выпуск не удался

```bash
ssh deploy@<IP> 'cd noova && docker compose logs -f api migrate'
make rollback SERVER=deploy@<IP> TAG=<тег прошлого выпуска>
```

Автоматического отката нет: миграции уже применены, и вернуть образ на схему
прошлого выпуска — значит получить код и базу вразнобой.

**Откат кода — одна строка, откат миграции — нет.** Миграции, удаляющие
колонки, разносить на два выпуска: перестать пользоваться → выпустить →
убедиться → удалить.
