# Развёртывание

| Документ | О чём |
|---|---|
| [server.md](server.md) | провайдер, DNS, подготовка машины |
| [release.md](release.md) | `.env` и выпуск |
| [mail.md](mail.md) | почтовый релей |
| [migration.md](migration.md) | переезд на другой домен или сервер |
| этот файл | порядок, база, бэкапы |

## Первое развёртывание

| | Шаг | Где |
|---|---|---|
| 1 | Заявка провайдеру: исходящий порт 25, PTR | [server.md](server.md) §4 |
| 2 | Проверить IP на `spamhaus.org` | [server.md](server.md) §4 |
| 3 | `A`-записи домена | [server.md](server.md) §1 |
| 4 | `ssh-copy-id`, `make server-setup` | [server.md](server.md) §3 |
| 5 | `make server-env` | [release.md](release.md) §1 |
| 6 | `make deploy` | [release.md](release.md) §2 |
| 7 | DKIM в DNS | [server.md](server.md) §4 |
| 7а | Если 25-й закрыт — релей | [mail.md](mail.md) |
| 8 | Справочники | [release.md](release.md) §3 |
| 9 | Первый администратор | [release.md](release.md) §4 |
| 10 | Проверить, что письмо не в спаме | [mail.md](mail.md) |
| 11 | Вывоз бэкапов за пределы сервера | §2 ниже |

Шаг 1 первый по времени отклика, не по важности: тикет идёт часы или сутки.
Шаг 11 — до того, как придут люди.

```bash
docker compose ps                      # все healthy
curl -I https://<домен>                # 200, валидный TLS
docker compose logs -f api             # ошибок нет
```

---

## 1. База

```bash
docker compose exec postgres psql -U noova -d noova -c '\dt'
docker compose exec postgres psql -U noova -d noova -c \
  "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc;"
docker compose exec -it postgres psql -U noova -d noova
```

`\dt` — таблицы, `\d "Profile"` — колонки, `\q` — выход.

Prisma Studio — **только через SSH-туннель**, порт наружу не открывать:

```bash
ssh -L 5555:localhost:5555 deploy@<IP>
docker compose exec api npx prisma studio --port 5555   # на сервере
```

Дальше `http://localhost:5555` у себя.

> Открытый наружу порт Postgres или Studio — прямой доступ ко всей базе
> с особой категорией персональных данных.

---

## 2. Бэкапы

Контейнер `backup` делает `pg_dump` по расписанию в `./backups/`
(`BACKUP_INTERVAL_SECONDS`, ротация `BACKUP_KEEP_DAYS`). Этого мало: дамп на
том же диске не спасает от потери сервера.

### Разовая подготовка

```bash
./infra/backup/make-key.sh ~/noova-backup            # у себя
scp ~/noova-backup/backup-public.pem deploy@<IP>:noova/
```

Закрытый ключ остаётся у вас — на сервере ему делать нечего.

### Снять и забрать

```bash
make backup-fetch SERVER=deploy@<IP> DIR=~/noova-backup
```

Дамп базы → архив фотографий → шифрование → скачивание. Порядок важен:
снимок между базой и фото добавит файл без строки (безвредно), обратный
порядок дал бы строку без файла.

### Проверить

```bash
make backup-open FILE=~/noova-backup/noova-<stamp>.sql.gz.enc \
                 KEY=~/noova-backup/backup-private.pem
make backup-verify FILE=~/noova-backup/noova-<stamp>.sql.gz
tar tzf ~/noova-backup/noova-media-<stamp>.tar.gz | wc -l   # сверить с выводом verify
```

`backup-verify` разворачивает дамп в отдельную базу, текущую не трогает.

### Восстановить

```bash
make restore DUMP=backups/noova-<stamp>.sql.gz
make restore-media ARCHIVE=noova-media-<stamp>.tar.gz
```

Обе разрушительные, требуют `yes`. Восстановление фото останавливает `minio`
на время распаковки.

> Дампы содержат особую категорию по GDPR. `backups/` не в git, копии
> шифруются до того, как покидают машину.
