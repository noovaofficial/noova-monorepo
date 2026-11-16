# Prod

Машина подготовлена — [vps.md](vps.md).

```bash
make deploy SERVER=deploy@<IP>
```

Собирает у вас, привозит образы, запускает, проверяет. На сервере не нужны ни
git, ни исходники.

---

## 1. `.env`

Два файла, и это разные файлы.

```bash
cat > .env.deploy <<'EOF'                    # у себя, только эти две строки
SITE_URL=https://noova.cc
PUBLIC_API_URL=https://noova.cc
EOF

make server-env SERVER=deploy@<IP> DOMAIN=noova.cc EMAIL=admin@example.com
```

Существующий серверный `.env` не перезаписывается: смена `POSTGRES_PASSWORD`
оставила бы базу недоступной.

> **Держите копию серверного `.env` вне сервера.** `POSTGRES_PASSWORD` открывает
> существующий том базы, `IP_HASH_SALT` — историю в журналах жалоб.

### Обязательные переменные

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
| `MINIO_APP_USER` | учётка, под которой api и jobs ходят в хранилище: любое имя, не равное `MINIO_ROOT_USER`, например `noova-app` |
| `MINIO_APP_PASSWORD` | `openssl rand -hex 32`. Без этих двух переменных `minio-init` завершается ошибкой и api не стартует |
| `IP_HASH_SALT` | `openssl rand -hex 32` |
| `REVALIDATE_SECRET` | `openssl rand -hex 32` |
| `PAYMENTO_API_KEY` / `PAYMENTO_SECRET_KEY` | Из кабинета `app.paymento.io`. Пустые — касса выключена. В настройках Paymento адрес IPN: `https://noova.cc/api/v1/billing/webhook/paymento` |
| `PAYWALL_ENABLED` | По умолчанию `true`. На новом сервере ставить `false` до запуска `grant-launch-listings`, затем `true` (payments.md, этап 3) |
| `INTERNAL_API_TOKEN` | `openssl rand -hex 32` |
| `MAIL_DOMAIN` | `noova.cc` |
| `MAIL_FROM` | `"Noova <noreply@noova.cc>"` |

- `tr -d '/+='` обязателен: пароль уходит в строку подключения.
- Три последних секрета обязаны быть случайными: по ним восстанавливаются
  адреса из журналов, снимается лимит запросов и сбрасывается кэш в цикле.
- **`SMTP_*` в серверном `.env` быть не должно.** В `.env.example` они смотрят
  на Mailpit, и API начнёт стучаться в самого себя.

---

## 2. Выпуск

```bash
make deploy SERVER=deploy@<IP>               # сборка, перенос, запуск, проверка
SKIP_TESTS=1 make deploy SERVER=deploy@<IP>  # обход тестов, аварийно
```

Скрипт сам: гоняет типы и тесты, проверяет `.env` и архитектуру, ставит тег по
коммиту, снимает дамп базы к вам, ждёт healthcheck и сверяет запущенное.

Порядок на сервере: postgres/redis/minio → `migrate` → `minio-init` → `api` →
`web` → `caddy`. Наружу смотрит только Caddy.

**Шум в логе сборки — норма:** `next build` пререндерит страницы, API в этот
момент нет. Смотреть надо на `ERROR` и `error:` от buildx.

### Без пересборки

```bash
make deploy-files SERVER=deploy@<IP>         # compose, Caddyfile, скрипты
make update SERVER=deploy@<IP>               # docker compose up -d
```

Для правок `.env`, `Caddyfile`, `docker-compose.yml`. Код так не выкатить.

---

## 3. После первого выпуска

```bash
# справочники: города и услуги, без них не пройти регистрацию
ssh deploy@<IP> "cd noova && docker compose exec api node dist/scripts/seed-reference.js"

# первый администратор, пароль от 10 символов
ssh deploy@<IP> "cd noova && docker compose exec api node dist/scripts/create-admin.js <email> '<пароль>'"
```

Оба идемпотентны, `make deploy` накатывает справочник сам.

> Правки справочника в админке живут до следующего выпуска. Порядок:
> поправили → выгрузили (`export-reference.js`) → закоммитили.

---

## 4. Проверка

```bash
docker compose ps                            # все healthy
curl -I https://<домен>                      # 200, валидный TLS
docker compose logs -f api
```

### База

```bash
docker compose exec postgres psql -U noova -d noova -c '\dt'
docker compose exec -it postgres psql -U noova -d noova
```

Prisma Studio — **только через туннель**, порт наружу не открывать:

```bash
ssh -L 5555:localhost:5555 deploy@<IP>
docker compose exec api npx prisma studio --port 5555   # на сервере
```

---

## 5. Если выпуск не удался

```bash
ssh deploy@<IP> 'cd noova && docker compose logs -f api migrate'
make rollback SERVER=deploy@<IP> TAG=<тег прошлого выпуска>
```

**Откат кода — одна строка, откат миграции — нет.** `prisma migrate deploy`
необратим. Миграции, удаляющие колонки, разносить на два выпуска: перестать
пользоваться → выпустить → убедиться → удалить.

| Симптом | Причина |
|---|---|
| `exec format error` | образ собран под другую архитектуру |
| `"url" parameter is not allowed` на фото | `NEXT_PUBLIC_MEDIA_URL` не доехала на сборку, лечится пересборкой |
| фронт ходит на старый домен | был `make update` вместо `make deploy` |

## 6. Образы

Сторонние образы в `docker-compose.yml` закреплены отпечатком
(`postgres@sha256:…`), а не тегом: тег автор образа может перевесить на
другую сборку, отпечаток — нет. Рядом с каждым в комментарии — тег, которому
он соответствовал, и дата.

Обратная сторона: исправления безопасности сами не приходят. Раз в один-два
месяца обновлять вручную:

```bash
docker pull postgres:17-alpine
docker image inspect postgres:17-alpine --format '{{index .RepoDigests 0}}'
```

Новый отпечаток — в `docker-compose.yml`, дату в комментарии поправить,
выпустить. Контейнер пересоздастся; данные в томах остаются. Postgres
обновлять только в пределах 17-й ветки: смена старшей версии требует
переноса данных.

**MinIO — исключение.** Образа в Docker Hub больше нет, скачать его нельзя.
В compose он записан тегом с `pull_policy: never`: образ должен уже лежать
на машине. На новую машину его переносит `make migrate-server`; вручную —

```bash
docker save minio/minio:latest | gzip > minio-image.tar.gz   # где он есть
gunzip -c minio-image.tar.gz | docker load                    # где нужен
```

Копию файла держать вне сервера. Уйдёт вместе с переносом медиа во внешнее
хранилище (`documentation/planning/backlog.md`, направление 1).

## 7. Content-Security-Policy

Сайт отдаёт политику, которая разрешает выполнять только свои скрипты
(`apps/web/src/shared/csp.ts`). Режим задаёт `CSP_MODE` в `.env` на сервере:

| Значение | Что делает |
|---|---|
| `report` (по умолчанию) | ничего не блокирует, браузеры шлют отчёты о нарушениях |
| `enforce` | блокирует |
| `off` | заголовка нет — аварийный выключатель |

Отчёты пишутся в лог api. Отчёты от расширений браузеров отбрасываются.

```bash
ssh deploy@<IP> 'cd noova && docker compose logs --since 168h api | grep "нарушение CSP"'
```

**Включение блокировки.** После недели в режиме `report` посмотреть лог. Если
нарушений от самого сайта нет (в поле `blocked` — только чужие адреса, которых
сайт не использует) — поставить `CSP_MODE=enforce` и перезапустить:
`make update SERVER=deploy@<IP>`. Пересборка не нужна. Если что-то сломалось —
вернуть `report` тем же способом.

**Новый внешний сервис** (капча, платёжный виджет, CDN на другом домене) —
добавить его адрес в `buildCsp`, иначе в режиме `enforce` он не загрузится.
Домен медиа подхватывается сам из `NEXT_PUBLIC_MEDIA_URL`.

У API своя политика, включена сразу: `default-src 'none'` — он отдаёт JSON и
файлы, выполнять в его ответах нечего.

## 8. Второй фактор сотрудников

Админы и модераторы входят паролем и кодом из приложения-аутентификатора
(TOTP). Остальных пользователей это не касается.

**Перед первым выкатом** — добавить ключ шифрования в `.env` на сервере:

```bash
ssh deploy@<IP> 'cd noova && cp .env .env.bak-mfa && echo "MFA_SECRET_KEY=$(openssl rand -hex 32)" >> .env'
```

Без ключа сайт работает, но сотрудники войти не смогут (в логе api:
`MFA_SECRET_KEY не задан`). Ключ **не менять**: настроенные факторы
перестанут расшифровываться. Копию ключа хранить вне сервера — вместе с
остальными секретами.

**После выката** все действующие сессии сотрудников перестают действовать.
При первом входе каждый проходит настройку: QR-код, подтверждение кодом,
десять резервных кодов (показываются один раз).

**Сотрудник потерял телефон и резервные коды:**

- другой админ — раздел «Сотрудники», кнопка «Сбросить второй фактор»;
- единственному админу (себе сбросить в интерфейсе нельзя) — на сервере:

```bash
ssh deploy@<IP> 'cd noova && docker compose exec api node dist/scripts/reset-mfa.js <email>'
```

После сброса сотрудник настраивает фактор заново при следующем входе. Сброс
пароля письмом второй фактор не снимает — так и задумано.
