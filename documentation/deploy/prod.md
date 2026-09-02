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
| `IP_HASH_SALT` | `openssl rand -hex 32` |
| `REVALIDATE_SECRET` | `openssl rand -hex 32` |
| `PAYMENTO_API_KEY` / `PAYMENTO_SECRET_KEY` | Из кабинета `app.paymento.io`. Пустые — касса выключена. В настройках Paymento адрес IPN: `https://noova.cc/api/v1/billing/webhook/paymento` |
| `PAYWALL_ENABLED` | `true` только после `billing:grant-launch` (payments.md, этап 3) |
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
