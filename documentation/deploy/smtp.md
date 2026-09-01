# SMTP

Отдельная машина под отправку, когда на Prod закрыт исходящий 25-й.
Подготовка машины и DNS — [vps.md](vps.md). Файлы — [`infra/relay/`](../../infra/relay/).

**Почему не внешний сервис.** SendPulse, SMTP2GO, Postmark, Resend, Brevo прямо
запрещают escort и adult; у Mailgun, Mailjet, SendGrid — оговорка на их
усмотрение. Блокировка аккаунта останавливает вход на сайт. Плюс релей видит
тело письма, а в нём одноразовая ссылка.

---

## 1. Сертификат

Только после того, как `A mail.<домен>` распространилась.

```bash
scp -r infra/relay deploy@<IP релея>:~/relay
ssh deploy@<IP релея> 'sudo ~/relay/certs.sh mail.<домен>'
```

Скрипт ставит хук продления — без него почта встанет через 90 дней.

## 2. Запуск

```bash
ssh deploy@<IP релея>
cd ~/relay
cat > .env <<'EOF'
MAIL_DOMAIN=<домен>
RELAY_USER=noreply@<домен>
RELAY_PASSWORD=<openssl rand -base64 24 | tr -d '/+='>
EOF
chmod 600 .env
docker compose up -d
```

## 3. Перенос DKIM-ключа с Prod

Контейнер сгенерировал свой при первом старте — заменяем, тогда запись в DNS
менять не придётся.

```bash
# на Prod
docker compose exec -T smtp tar cf - -C /etc/opendkim/keys . > ~/dkim.tar && chmod 600 ~/dkim.tar
# через свою машину
scp deploy@<IP Prod>:dkim.tar /tmp/ && scp /tmp/dkim.tar deploy@<IP релея>:dkim.tar
# на релее
docker compose exec -T smtp tar xf - -C /etc/opendkim/keys < ~/dkim.tar
docker compose restart smtp
docker compose exec smtp cat /etc/opendkim/keys/<домен>.txt
```

**Удалить архив со всех трёх машин** — в нём приватный ключ.

В DNS идёт `mail._domainkey` со значением из **склеенных подряд** кусков в
кавычках — без кавычек, скобок и комментария после `;`.

```bash
dig +short TXT mail._domainkey.<домен> @1.1.1.1
```

## 4. Переключить Prod на релей

```bash
cat >> ~/noova/.env <<'EOF'
RELAY_HOST=[mail.<домен>]:587
RELAY_USER=noreply@<домен>
RELAY_PASSWORD=<тот же>
RELAY_TLS_LEVEL=encrypt
EOF

make deploy-files SERVER=deploy@<IP Prod>
make update SERVER=deploy@<IP Prod>
```

`>>`, не `>` — иначе сотрёте пароль базы. В `RELAY_HOST` имя, не IP:
сертификат выписан на `mail.<домен>`. `RELAY_USER` совпадает с адресом из
`MAIL_FROM`. Пустые `RELAY_*` = отправка напрямую.

---

## Проверка

```bash
docker compose exec smtp postqueue -p        # на Prod: пусто
docker compose logs -f smtp                  # на релее
```

Ждём `sasl_username=noreply@<домен>` и `status=sent (250 ...)`. Затем
регистрация на сайте, в заголовках `dkim=pass` и `dmarc=pass`. Финально —
`mail-tester.com`.

---

## Если письма не уходят

| Симптом | Причина |
|---|---|
| `SSL_accept error`, очередь Postfix пуста | nodemailer рвёт соединение из-за самоподписанного сертификата. `POSTFIX_smtpd_tls_security_level: none` на Prod |
| `authentication failed` | `RELAY_USER`/`RELAY_PASSWORD` разошлись. Сверять по `sasl_username=` в логе релея |
| `unable to canonify user and get auxprops` | выбран DIGEST-MD5. `POSTFIX_smtp_sasl_mechanism_filter: plain, login` |
| `sasl_username` не тот, что в `.env` | образ дописывает `sasl_passwd` при старте: нужен `up -d --force-recreate` |
| `554 Sender address rejected` | образ переписал карты с `hash:` на `lmdb:`, пересоздать контейнер |
| `certificate verify failed` | в `RELAY_HOST` IP вместо имени, или сертификат не выпущен |
| `Connection timed out` на релее | исходящий 25-й закрыт у провайдера релея |
| `Connection refused` на Prod | ufw на релее не пускает, или контейнер не поднят |
| уходят, но в спам | PTR/SPF/DKIM или репутация нового домена — прогрев |
| встало через ~3 месяца | сертификат, проверить хук продления |

**Общее правило:** у `boky/postfix` `restart` не применяет изменения окружения.
Нужен `docker compose up -d --force-recreate`.

## Обслуживание

```bash
sudo certbot renew --dry-run                 # на релее
```

Первые недели объём наращивать постепенно. Периодически проверять IP на
`check.spamhaus.org`.

## Возврат к прямой отправке

Удалить четыре строки `RELAY_*` из `~/noova/.env`, вернуть `A mail.<домен>` и
`ip4:` в SPF на IP Prod, запросить там PTR, перенести ключ обратно.
