# Переезд

Три сценария. Если меняются и домен, и сервер — делайте **последовательно**,
не одновременно: сначала сервер на старом домене, убедились, потом домен.

---

## 1. Новый домен

### 1.1 DNS на новом домене

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | IP основного сервера |
| A | `mail` | IP релея |
| TXT | `@` | `v=spf1 ip4:<IP релея> ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<ящик вне домена>` |
| MX | `@` | пересылка, если адрес поддержки публикуется |

`AAAA` не добавлять. SPF-запись должна быть одна.

### 1.2 Релей

```bash
ssh deploy@<IP релея>
cd ~/relay
sed -i 's/^MAIL_DOMAIN=.*/MAIL_DOMAIN=<новый>/' .env
sed -i 's/^RELAY_USER=.*/RELAY_USER=noreply@<новый>/' .env
sudo ./certs.sh mail.<новый>
docker compose up -d --force-recreate smtp
docker compose exec smtp cat /etc/opendkim/keys/<новый>.txt
```

**Ключ DKIM будет новый.** Файл называется по домену, для нового домена
образ сгенерирует свой — старый не подойдёт. Вывод последней команды
опубликовать как `mail._domainkey` на новом домене.

PTR у провайдера релея переставить на `mail.<новый>`.

### 1.3 Сервер

```bash
ssh deploy@<IP>
cd ~/noova
sed -i 's|^SITE_DOMAIN=.*|SITE_DOMAIN=<новый>|;
        s|^SITE_URL=.*|SITE_URL=https://<новый>|;
        s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://<новый>|;
        s|^MEDIA_BASE_URL=.*|MEDIA_BASE_URL=https://<новый>/media|;
        s|^MAIL_DOMAIN=.*|MAIL_DOMAIN=<новый>|;
        s|^MAIL_FROM=.*|MAIL_FROM="Noova <noreply@<новый>>"|;
        s|^RELAY_HOST=.*|RELAY_HOST=[mail.<новый>]:587|;
        s|^RELAY_USER=.*|RELAY_USER=noreply@<новый>|' .env
grep -E 'SITE_|MAIL_|RELAY_' .env
```

### 1.4 Пересборка обязательна

```bash
cat > .env.deploy <<'EOF'
SITE_URL=https://<новый>
PUBLIC_API_URL=https://<новый>
EOF
make deploy SERVER=deploy@<IP>
```

`make update` здесь не годится: адреса запекаются в браузерный бандл на
сборке. Без пересборки фронт продолжит ходить на старый домен.

### 1.5 Проверка

```bash
curl -I https://<новый>                      # 200, сертификат выпустится сам
dig +short -x <IP релея> @1.1.1.1            # mail.<новый>.
dig +short TXT mail._domainkey.<новый> @1.1.1.1
```

Затем регистрация на сайте → письмо не в спаме.

> Репутация отправителя к новому домену **не переезжает**. Первые недели
> объём наращивать постепенно, как при первом запуске.

Старый домен: либо редирект на новый, либо просто оставить истекать.

---

## 2. Новый сервер, домен прежний

### 2.1 Заранее

Снизить TTL на `A @` до 300 секунд — за сутки до переезда.

### 2.2 Подготовить машину

```bash
ssh-copy-id -i ~/.ssh/<ключ>.pub root@<новый IP>
make server-setup SERVER=root@<новый IP>
ssh root@<новый IP> passwd deploy
```

### 2.3 Снять копию со старого

```bash
make backup-fetch SERVER=deploy@<старый IP> DIR=~/noova-backup
scp deploy@<старый IP>:noova/.env ~/noova-backup/env.old
```

**`.env` переносится целиком.** Сгенерировать заново нельзя: с другим
`POSTGRES_PASSWORD` дамп не восстановится.

### 2.4 Развернуть

```bash
scp ~/noova-backup/env.old deploy@<новый IP>:noova/.env
ssh deploy@<новый IP> 'chmod 600 noova/.env'
make deploy SERVER=deploy@<новый IP>
```

`make server-env` **не запускать** — он сгенерирует новые секреты.

### 2.5 Восстановить данные

```bash
make backup-open FILE=~/noova-backup/noova-<stamp>.sql.gz.enc \
                 KEY=~/noova-backup/backup-private.pem
scp ~/noova-backup/noova-<stamp>.sql.gz deploy@<новый IP>:noova/backups/
scp ~/noova-backup/noova-media-<stamp>.tar.gz deploy@<новый IP>:noova/

ssh deploy@<новый IP>
cd ~/noova
make restore DUMP=backups/noova-<stamp>.sql.gz
make restore-media ARCHIVE=noova-media-<stamp>.tar.gz
```

Сначала база, потом фотографии.

### 2.6 Релей пропустит новый адрес

```bash
ssh deploy@<IP релея>
sudo ufw allow from <новый IP> to any port 587 proto tcp
sudo ufw status numbered            # старое правило удалить после переключения
```

Забыть этот шаг — письма встанут с `Connection refused`.

### 2.7 Переключить DNS

```bash
# A @ → новый IP, затем:
dig +short A <домен> @1.1.1.1
curl -I https://<домен>
```

SPF не трогать: в нём IP релея, а не основного сервера.

### 2.8 После проверки

```bash
ssh deploy@<IP релея> 'sudo ufw delete allow from <старый IP> to any port 587 proto tcp'
```

Старый сервер держать сутки-двое выключенным, но не удалённым. Потом
удалять — вместе с ключом бэкапа, если он там лежал.

---

## 3. Новый домен и новый сервер

Не одновременно. Порядок:

1. Раздел 2 целиком — новый сервер на **старом** домене.
2. Убедиться, что сайт и почта работают.
3. Раздел 1 целиком — новый домен.

Причина: при одновременной смене нечем отделить поломку DNS от поломки
переноса данных. Второй шаг стоит десять минут, разбор совмещённой аварии —
вечер.

---

## Что ломается чаще всего

| Симптом | Причина |
|---|---|
| Фронт ходит на старый домен | не было пересборки, `make update` вместо `make deploy` |
| База не открывается после restore | `.env` сгенерирован заново, `POSTGRES_PASSWORD` другой |
| Письма встали, `Connection refused` | ufw на релее не пускает новый IP |
| `dkim=fail` после смены домена | опубликован старый ключ, нужен новый из контейнера |
| Сертификат не выпускается | `A`-запись ещё не распространилась, либо висит `AAAA` |
| Письма ушли в спам после переезда | репутация домена не переносится, нужен прогрев |
