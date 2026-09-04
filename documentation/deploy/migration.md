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
                    RELAY=deploy@<релей> \
                    STORAGE=deploy@<хранилище копий>
```

Снимает копию со старого, переносит `.env` и **образы** без пересборки,
разворачивает данные, поднимает стек, открывает 587-й на релее. Если задан
`STORAGE` — переносит ещё и открытый ключ шифрования копий, разрешение для
ключа хранилища на новом сервере и переключает `PULL_FROM` на самом
хранилище (backup.md). `STORAGE` необязателен: без него всё то же самое
нужно сделать вручную командами `make backup-allow-pull` и правкой
`~/noova-pull.env`.

**Скрипт останавливается перед переключением DNS** — до него всё обратимо.
Дальше вручную:

```bash
curl -H 'Host: <домен>' http://<новый IP>/healthz   # пока DNS смотрит на старый
# переключить A @ на новый IP
dig +short A <домен> @1.1.1.1 && curl -I https://<домен>
# сброс пароля на сайте — письмо должно уйти
ssh <релей> 'sudo ufw status numbered && sudo ufw delete <номер>'   # через сутки

# если задавали STORAGE — хранилищу нужно вручную принять host key нового
# сервера, скрипт это нарочно не делает сам (единственный момент заметить
# подмену машины):
ssh deploy@<новый> 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'   # сверить отпечаток
ssh -i ~/.ssh/noova-pull deploy@<новый> snapshot-db > /dev/null        # с хранилища
ssh deploy@<хранилище> 'bash ~/pull.sh'                                 # проверить цикл целиком
```

| Отказ скрипта | Что значит |
|---|---|
| `На <TO> уже есть noova/.env` | целевая машина не пустая, восстановление затёрло бы базу |
| `есть том noova_postgres_data` | остался от прошлой попытки |
| `нет Docker или пользователь не в группе docker` | не сделан `make server-setup` |
| `В .env старого сервера нет IMAGE_TAG` | старый сервер выпускался не через `make deploy` |

### 2а. Заодно уходим с релея (у нового провайдера открыт исходящий 25-й)

Мейлер и так живёт в основном стеке — сервис `smtp` в `docker-compose.yml`,
[smtp.md](smtp.md). Релей нужен только затем, что провайдер старого Prod
держит исходящий 25-й закрытым. Если у нового провайдера порт открыт, релей
как отдельная машина больше не нужен — собственный Postfix новой машины
отправляет сам, как до N-15 ([constraints.md](../arch/constraints.md), N-15).

```bash
make migrate-server FROM=deploy@<старый> TO=deploy@<новый> \
                    KEY=~/noova-backup/backup-private.pem \
                    DIRECT_MAIL=1
```

В отличие от `RELAY=`, флаг `DIRECT_MAIL=1`:
- вычищает `RELAY_HOST`/`RELAY_USER`/`RELAY_PASSWORD`/`RELAY_TLS_LEVEL` из
  `.env`, который иначе переехал бы как есть и продолжил стучаться в релей;
- переносит **ключ DKIM** из `dkim_keys` старого сервера в `dkim_keys` нового
  и перезапускает `smtp` — без этого шага (он выполняется в обоих режимах,
  и с `RELAY=`, и с `DIRECT_MAIL=1`) новый сервер сгенерировал бы свой ключ
  при первом старте, он разошёлся бы с опубликованной в DNS `mail._domainkey`,
  и письма стали бы уходить с `dkim=fail`.

Перед отправкой первого письма, ещё до переключения `A @` на новый IP:

```bash
# DNS почты теперь указывает на новый Prod, а не на релей
A    mail.<домен>   → <новый IP>
TXT  <домен>        → v=spf1 ip4:<новый IP> ~all
```

И PTR на `<новый IP>` → `mail.<домен>` — закажите у нового провайдера
заранее, без него письма отклоняют на входе (та же оговорка, что и для
самого релея в [smtp.md](smtp.md)). Скрипт печатает эти три пункта в конце
со своим значением `<новый IP>` — их не нужно вычислять руками.

Репутация IP не переезжает: первые недели после переключения объём
наращивать постепенно, как при первом запуске релея.

Старый релей после переезда никому не нужен — можно погасить не сразу,
как и старый Prod.

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
