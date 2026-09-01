# Переезд

Три сценария. Если меняются и домен, и сервер — **последовательно**: сначала
сервер на старом домене, убедились, потом домен. При одновременной смене нечем
отделить поломку DNS от поломки переноса данных.

---

## 1. Новый домен

### DNS

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | IP Prod |
| A | `mail` | IP релея |
| TXT | `@` | `v=spf1 ip4:<IP релея> ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<ящик вне домена>` |

`AAAA` не добавлять. SPF-запись одна.

### Релей

```bash
ssh deploy@<IP релея>
cd ~/relay
sed -i 's/^MAIL_DOMAIN=.*/MAIL_DOMAIN=<новый>/;
        s/^RELAY_USER=.*/RELAY_USER=noreply@<новый>/' .env
sudo ./certs.sh mail.<новый>
docker compose up -d --force-recreate smtp
docker compose exec smtp cat /etc/opendkim/keys/<новый>.txt   # в DNS
```

**Ключ DKIM будет новый:** файл называется по домену, старый не подойдёт.
PTR у провайдера релея переставить на `mail.<новый>`.

### Prod

```bash
ssh deploy@<IP> 'cd noova && sed -i "
  s|^SITE_DOMAIN=.*|SITE_DOMAIN=<новый>|;
  s|^SITE_URL=.*|SITE_URL=https://<новый>|;
  s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://<новый>|;
  s|^MEDIA_BASE_URL=.*|MEDIA_BASE_URL=https://<новый>/media|;
  s|^MAIL_DOMAIN=.*|MAIL_DOMAIN=<новый>|;
  s|^MAIL_FROM=.*|MAIL_FROM=\"Noova <noreply@<новый>>\"|;
  s|^RELAY_HOST=.*|RELAY_HOST=[mail.<новый>]:587|;
  s|^RELAY_USER=.*|RELAY_USER=noreply@<новый>|" .env'

cat > .env.deploy <<'EOF'
SITE_URL=https://<новый>
PUBLIC_API_URL=https://<новый>
EOF
make deploy SERVER=deploy@<IP>
```

**Пересборка обязательна.** `make update` не годится: адреса запекаются в
браузерный бандл на сборке.

```bash
curl -I https://<новый>                      # 200, сертификат выпустится сам
dig +short -x <IP релея> @1.1.1.1            # mail.<новый>.
dig +short TXT mail._domainkey.<новый> @1.1.1.1
```

> Репутация отправителя к новому домену не переезжает — первые недели объём
> наращивать постепенно.

---

## 2. Новый сервер, домен прежний

```bash
# за сутки: снизить TTL на A @ до 300 секунд
ssh-copy-id -i ~/.ssh/<ключ>.pub root@<новый IP>
ssh -t root@<новый IP> 'adduser --disabled-password --gecos "" deploy; passwd deploy'
make server-setup SERVER=root@<новый IP>

make migrate-server FROM=deploy@<старый> TO=deploy@<новый> \
                    KEY=~/noova-backup/backup-private.pem \
                    RELAY=deploy@<релей>
```

Снимает копию со старого, переносит `.env` и **образы** без пересборки,
разворачивает данные, поднимает стек, открывает 587-й на релее.

**Скрипт останавливается перед переключением DNS** — до него всё обратимо.
Дальше вручную:

```bash
curl -H 'Host: <домен>' http://<новый IP>/healthz   # пока DNS смотрит на старый
# переключить A @ на новый IP
dig +short A <домен> @1.1.1.1 && curl -I https://<домен>
# сброс пароля на сайте — письмо должно уйти
ssh <релей> 'sudo ufw status numbered && sudo ufw delete <номер>'   # через сутки
```

| Отказ скрипта | Что значит |
|---|---|
| `На <TO> уже есть noova/.env` | целевая машина не пустая, восстановление затёрло бы базу |
| `есть том noova_postgres_data` | остался от прошлой попытки |
| `нет Docker или пользователь не в группе docker` | не сделан `make server-setup` |
| `В .env старого сервера нет IMAGE_TAG` | старый сервер выпускался не через `make deploy` |

### Вручную

```bash
make backup-fetch SERVER=deploy@<старый> DIR=~/noova-backup
scp deploy@<старый>:noova/.env ~/noova-backup/env.old
scp ~/noova-backup/env.old deploy@<новый>:noova/.env
ssh deploy@<новый> 'chmod 600 noova/.env'
make deploy SERVER=deploy@<новый>

make backup-open FILE=~/noova-backup/noova-<stamp>.sql.gz.enc \
                 KEY=~/noova-backup/backup-private.pem
scp ~/noova-backup/noova-<stamp>.sql.gz deploy@<новый>:noova/
scp ~/noova-backup/noova-media-<stamp>.tar.gz deploy@<новый>:noova/

ssh deploy@<новый> 'cd noova && ./infra/backup/restore.sh noova-<stamp>.sql.gz'
ssh deploy@<новый> 'cd noova && ./infra/backup/restore-media.sh noova-media-<stamp>.tar.gz'
ssh deploy@<новый> 'rm -f noova/noova-*.gz'        # открытые копии не оставляем

ssh deploy@<релей> 'sudo ufw allow from <новый IP> to any port 587 proto tcp'
```

**`.env` переносится целиком, `make server-env` не запускать.** Дамп встанет с
любым паролем, а вот `IP_HASH_SALT` обязан совпасть: им хэшируются адреса в
журналах жалоб, и с новой солью записи одного человека перестанут схлопываться.
Восстановить нельзя, сырых адресов мы не храним.

Сначала база, потом фотографии. SPF не трогать: в нём IP релея.

---

## 3. Новый домен и новый сервер

1. Раздел 2 целиком — новый сервер на **старом** домене.
2. Убедиться, что сайт и почта работают.
3. Раздел 1 целиком — новый домен.

---

## Что ломается чаще всего

| Симптом | Причина |
|---|---|
| Фронт ходит на старый домен | не было пересборки, `make update` вместо `make deploy` |
| Журналы раскрытий «рассыпались» | `.env` сгенерирован заново, `IP_HASH_SALT` другой |
| Все разлогинены | ожидаемо: сессии в Redis, он в копию не входит |
| Письма встали, `Connection refused` | ufw на релее не пускает новый IP |
| `dkim=fail` после смены домена | опубликован старый ключ, нужен новый из контейнера |
| Сертификат не выпускается | `A` ещё не распространилась, либо висит `AAAA` |
| Письма в спам после переезда | репутация домена не переносится, нужен прогрев |
