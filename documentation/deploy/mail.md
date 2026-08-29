# Почтовый релей

Отдельная машина под отправку, когда провайдер основного сервера держит
исходящий 25-й закрытым. Общая часть про почту — [server.md](server.md) §4.

**Почему не внешний сервис.** SendPulse, SMTP2GO, Postmark, Resend, Elastic
Email, Brevo прямо запрещают escort и adult в AUP; у Mailgun, Mailjet,
SendGrid — оговорка про «obscene, indecent» на их усмотрение. Блокировка
аккаунта останавливает вход на сайт. Плюс релей видит тело письма, а в нём
одноразовая ссылка. Решение N-15 в силе, Postfix просто на второй машине.

**Провайдер.** Открытый исходящий 25-й, разрешённый adult, юрисдикция ЕС/ЕЭЗ
(L-09). Подтверждать письмом до оплаты.

Файлы — [`infra/relay/`](../../infra/relay/).

---

## Настройка

### 1. Проверки

```bash
timeout 8 bash -c 'exec 3<>/dev/tcp/aspmx.l.google.com/25 && head -1 <&3'
```

`220 ... ESMTP` — открыт, молчание — дальше идти незачем.
IP проверить на `check.spamhaus.org`, в списках — просить замену.

### 2. Машина

```bash
ssh-copy-id -i ~/.ssh/<ключ>.pub root@<IP релея>
make server-setup SERVER=root@<IP релея>
ssh root@<IP релея> passwd deploy
sudo ufw allow from <IP основного> to any port 587 proto tcp
```

Submission только основному серверу: открытый всему миру находят за часы.

### 3. DNS

| Запись | Значение |
|---|---|
| `A mail.<домен>` | IP релея |
| TXT `@` (SPF) | `v=spf1 ip4:<IP релея> ~all` |
| PTR | `mail.<домен>` — в панели провайдера или заявкой |
| TXT `mail._domainkey` | **не трогать**, ключ переносится |

```bash
dig +short A mail.<домен> @1.1.1.1
dig +short -x <IP релея> @1.1.1.1
```

Имя должно совпадать в трёх местах: HELO, PTR, A-запись.

### 4. Сертификат

Только после того, как A-запись распространилась.

```bash
scp -r infra/relay deploy@<IP релея>:~/relay
ssh deploy@<IP релея> 'sudo ~/relay/certs.sh mail.<домен>'
```

Скрипт ставит хук продления — без него почта встала бы через 90 дней.

### 5. Запуск

```bash
cd ~/relay
cat > .env <<'EOF'
MAIL_DOMAIN=<домен>
RELAY_USER=noreply@<домен>
RELAY_PASSWORD=<openssl rand -base64 24 | tr -d '/+='>
EOF
chmod 600 .env
docker compose up -d
```

### 6. DKIM-ключ со старой машины

Контейнер сгенерировал свой при первом старте — заменяем, тогда запись в DNS
менять не придётся.

```bash
# на основном
docker compose exec -T smtp tar cf - -C /etc/opendkim/keys . > ~/dkim.tar && chmod 600 ~/dkim.tar
# перенос через свою машину
scp deploy@<IP основного>:dkim.tar /tmp/ && scp /tmp/dkim.tar deploy@<IP релея>:dkim.tar
# на релее
docker compose exec -T smtp tar xf - -C /etc/opendkim/keys < ~/dkim.tar
docker compose restart smtp
docker compose exec smtp cat /etc/opendkim/keys/<домен>.txt
```

Сверить с `dig +short TXT mail._domainkey.<домен> @1.1.1.1`.
**Удалить архив со всех трёх машин** — в нём приватный ключ.

### 7. Основной сервер

```bash
cat >> ~/noova/.env <<'EOF'

RELAY_HOST=[mail.<домен>]:587
RELAY_USER=noreply@<домен>
RELAY_PASSWORD=<тот же>
RELAY_TLS_LEVEL=encrypt
EOF
```

`>>`, не `>` — иначе сотрёте пароль базы. Имя, не IP: сертификат выписан на
`mail.<домен>`. `RELAY_USER` в обоих файлах одинаковый и равен адресу из
`MAIL_FROM`.

```bash
make deploy-files SERVER=deploy@<IP основного>
make update SERVER=deploy@<IP основного>
```

---

## Проверка

```bash
docker compose exec smtp postqueue -p      # на основном: пусто
docker compose logs -f smtp                # на релее
```

Ждём `sasl_username=noreply@<домен>` и `status=sent (250 ...)`.
Затем регистрация на сайте, в заголовках `dkim=pass` и `dmarc=pass`.
Финально — `mail-tester.com`.

---

## Если письма не уходят

| Симптом | Причина |
|---|---|
| `SSL_accept error from noova-api-1`, очередь Postfix **пуста** | nodemailer проверяет самоподписанный сертификат и рвёт соединение. `POSTFIX_smtpd_tls_security_level: none` на основном |
| `authentication failed` | `RELAY_USER`/`RELAY_PASSWORD` разошлись. Сверять по `sasl_username=` в логе релея |
| `unable to canonify user and get auxprops` | выбран DIGEST-MD5, он сверяет realm. `POSTFIX_smtp_sasl_mechanism_filter: plain, login` |
| `sasl_username` не тот, что в `.env` | образ **дописывает** `sasl_passwd` при старте. Нужен `up -d --force-recreate`, не `restart` |
| `554 Sender address rejected: Access denied` | образ переписал карты с `hash:` на `lmdb:`, но не пересобрал. Пересоздать контейнер |
| `error: open database /etc/aliases.lmdb` | та же поломка карт, тот же рецепт |
| `certificate verify failed` | в `RELAY_HOST` IP вместо имени, или сертификат не выпущен |
| `Connection timed out` на релее | исходящий 25-й закрыт у провайдера релея |
| `Connection refused` на основном | ufw на релее не пускает, или контейнер не поднят |
| уходят, но в спам | PTR/SPF/DKIM — прогнать `mail-tester.com`; либо репутация нового домена |
| встало через ~3 месяца | сертификат, проверить хук продления |

**Общее правило:** у `boky/postfix` `restart` не применяет изменения
окружения и накапливает состояние. Нужен `docker compose up -d --force-recreate`.

---

## Обслуживание

- **Прогрев** — первые недели объём наращивать постепенно.
- **Чёрные списки** — периодически проверять IP на `check.spamhaus.org`.
- **Сертификат** — `sudo certbot renew --dry-run` на релее.

## Возврат к прямой отправке

Удалить четыре строки `RELAY_*` из `~/noova/.env`, вернуть `A mail.<домен>` и
`ip4:` в SPF на основной IP, запросить там PTR, перенести ключ обратно.
