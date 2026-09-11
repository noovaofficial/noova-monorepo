# Почта

Отдельная машина под почту доменов noova.fyi и noova.cc: отправка писем
сайта, приём, ящики, веб-почта. На ней же живёт лендинг будущего продукта —
площадке не нужны ни база, ни API, третья машина ради статики не оправдана.
Подготовка машины и DNS — [vps.md](vps.md). Файлы —
[`infra/relay/`](../../infra/relay/).

**Зачем отдельная машина.** Провайдер Prod держит исходящий 25-й закрытым.

**Почему не внешний сервис.** SendPulse, SMTP2GO, Postmark, Resend, Brevo прямо
запрещают escort и adult; у Mailgun, Mailjet, SendGrid — оговорка на их
усмотрение. Блокировка аккаунта останавливает вход на сайт. Плюс релей видит
тело письма, а в нём одноразовая ссылка.

**Почему Stalwart.** Один процесс на отправку, приём, IMAP, DKIM, антиспам и
админку. До него здесь стоял Postfix, который умел только отправлять.

**Почему Roundcube.** Своей веб-почты у Stalwart пока нет. Roundcube
бесплатный (GPL-3.0) и регулярно получает исправления безопасности — для
страницы, через которую видна вся переписка, это главное. SnappyMail не
выпускал релизов с октября 2024.

---

## Как устроено

```
api → Postfix на Prod ─587, noreply, TLS─► Stalwart ─25─► серверы получателей
       (очередь)                              ▲
интернет ─────────────────25──────────────────┤──► ящики noova.fyi и noova.cc
почтовые клиенты ─────────993, 465────────────┤
браузер ─443─ Caddy ─ Roundcube ──993, 465────┤    webmail.noova.fyi
браузер ──────────────────8443────────────────┘    админка Stalwart
```

На Prod ничего не меняется: Postfix копит очередь, пока релей недоступен, и
сдаёт письма по 587-му с паролем `noreply`. Он же подписывает их тем же
ключом DKIM, что лежит на релее.

**Где что настраивается.**

- [`stalwart/plan.ndjson`](../../infra/relay/stalwart/plan.ndjson) — всё, от
  чего зависит работа почты. Меняется только в репозитории и накатывается
  командой из раздела «Накатить план».
- Админка Stalwart — ящики, алиасы, пароли людей.
- [`roundcube/config.inc.php`](../../infra/relay/roundcube/config.inc.php) —
  веб-почта.

То, что описано в плане, в админке не менять: следующий накат перезапишет.

| В плане | Зачем |
|---|---|
| порты 25, 587, 465, 993, 8443 — и только они | без явного списка Stalwart поднимает встроенный набор, в том числе 8080 без TLS и без 587-го |
| имя `mail.noova.fyi` | HELO, PTR и A-запись должны совпадать |
| домены noova.fyi и noova.cc, у каждого свой DKIM (селектор `mail`) | письмо подписывается ключом домена отправителя: от `@noova.cc` — ключом noova.cc |
| `noreply` входит только с IP Prod | утёкший пароль с чужого адреса не пустит |
| IP Prod вне автобана | после серии неверных паролей Stalwart закрывает адрес целиком, вместе с 587-м, — то есть с письмами регистрации |
| бан на сутки | по умолчанию — навсегда, до ручного разбана |
| пустой отправитель только у `noreply` | так Postfix на Prod шлёт уведомления о недоставке |
| исходящие только по IPv4 | у машины есть IPv6, но PTR и SPF есть только у IPv4 |
| логи в консоль | по умолчанию Stalwart пишет в файл внутри контейнера, и `docker compose logs` пуст |

Учётки `admin` в плане нет намеренно: она создаётся один раз, и повторный
накат иначе перезаписывал бы её пароль и 2FA, включённую в админке.

Адреса Caddy и Stalwart фиксированные (сеть `mail` в compose): Roundcube
верит `X-Forwarded-For` только от адреса Caddy, а имя `mail.noova.fyi` внутри
контейнера Roundcube указывает на адрес Stalwart.

---

## Первый запуск

Для машины, где уже работают Caddy и Postfix. Почта на время работ не
отправляется: письма ждут в очереди Postfix на Prod.

### 1. Файлы и `.env`

```bash
# у себя
COPYFILE_DISABLE=1 tar -C infra/relay -cf - . | ssh deploy@<IP релея> 'tar -C relay -xf -'
```

`tar`, а не `scp -r`: повторный `scp -r` в существующий `~/relay` кладёт
файлы в `~/relay/relay`. `.env`, `certs` и `dkim` на релее не трогаются.
`COPYFILE_DISABLE=1` — на macOS: без него tar добавляет к каждому файлу
служебный `._<имя>`, и Caddy отдавал бы такие из `landing/` публично.

```bash
# на релее: ключ шифрования сессий веб-почты
echo "ROUNDCUBE_DES_KEY=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)" >> ~/relay/.env
```

Без него Roundcube генерирует новый ключ при каждом пересоздании контейнера,
и всех выкидывает из веб-почты.

### 2. Postfix — остановить, ключи DKIM — забрать

```bash
ssh -t deploy@<IP релея>
cd ~/relay
sudo -v
docker ps --format '{{.Names}}' | grep smtp    # обычно relay-smtp-1
docker rm -f relay-smtp-1

sudo install -d -m 750 -o root -g 2000 dkim
for d in noova.fyi noova.cc; do
  docker run --rm --user 0 -v relay_dkim_keys:/k:ro --entrypoint cat stalwartlabs/stalwart:v0.16.21 \
    /k/$d.private | sudo tee dkim/$d.private >/dev/null
  sudo chown root:2000 dkim/$d.private && sudo chmod 640 dkim/$d.private
  echo "$d: v=DKIM1; k=rsa; p=$(sudo openssl pkey -in dkim/$d.private -pubout | grep -v '^-' | tr -d '\n')"
done
```

Напечатанные строки — значения `TXT mail._domainkey` для каждого домена.
Там, где запись уже опубликована, сверить: `dig +short TXT
mail._domainkey.<домен> @1.1.1.1`. Не совпадёт — письма уйдут с `dkim=fail`.

Том `relay_dkim_keys` не удалять: это запасная копия ключей.

### 3. Сертификат, порты, stalwart-cli

```bash
sudo ./certs.sh mail.noova.fyi                 # права под Stalwart, хук продления
sudo ufw allow 25,465,993,8443/tcp             # 587 уже открыт только для Prod

curl -fsSLO https://github.com/stalwartlabs/cli/releases/download/v1.0.12/stalwart-cli-x86_64-unknown-linux-musl.tar.xz
echo "76fcd7250a10c7bee704dc4a08000b3faca6b5a22895d41831c0c37efd95acce  stalwart-cli-x86_64-unknown-linux-musl.tar.xz" | sha256sum -c
tar -xJf stalwart-cli-x86_64-unknown-linux-musl.tar.xz
mv stalwart-cli-x86_64-unknown-linux-musl/stalwart-cli . && rm -rf stalwart-cli-x86_64-unknown-linux-musl*
```

Контрольная сумма обязательна: CLI получает пароль администратора.

### 4. План и учётка admin

Команды раздела «Накатить план» ниже, а перед `docker rm -f stalwart-apply` —
учётка администратора:

```bash
ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=')"
echo "Пароль admin@noova.fyi: $ADMIN_PASSWORD"   # сохранить в менеджер паролей
{ head -1 stalwart/plan.ndjson; cat <<EOF
{"@type":"upsert","object":"Account","matchOn":["name","domainId"],"value":{"admin":{"@type":"User","name":"admin","domainId":"#d","description":"администратор","roles":{"@type":"Admin"},"credentials":{"0":{"@type":"Password","secret":"$ADMIN_PASSWORD"}}}}}
EOF
} | ./stalwart-cli apply --stdin
```

### 5. Запуск

```bash
docker compose up -d --remove-orphans
docker compose logs stalwart | grep -E 'listen-start|build-error'   # 5 портов, ни одного build-error
docker compose ps                                                   # caddy, stalwart, roundcube
```

На Prod — отправить накопившееся:

```bash
docker compose exec smtp postqueue -f
```

### 6. DNS

| Домен | Тип | Имя | Значение |
|---|---|---|---|
| noova.fyi | A | `webmail` | IP релея |
| noova.fyi | MX | `@` | `mail.noova.fyi`, приоритет 10 |
| noova.fyi | TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:<ящик вне домена>` — в значении только это |
| noova.cc | MX | `@` | `mail.noova.fyi`, приоритет 10 |
| noova.cc | TXT | `@` | `v=spf1 ip4:<IP релея> ~all` |
| noova.cc | TXT | `mail._domainkey` | строка для noova.cc из шага 2 |

У noova.cc DMARC `p=reject`: пока нет SPF и DKIM, письма с `@noova.cc`
отклоняются. MX переключать последним — после того как ящики на noova.cc
заведены, а отправка с них проверена.

---

## Накатить план

После любой правки `stalwart/plan.ndjson`. Почта стоит около минуты: план
накатывается в режиме восстановления, где открыт только API управления и
только на 127.0.0.1.

```bash
cd ~/relay
docker compose stop stalwart
P="$(openssl rand -hex 24)"
docker compose run -d --no-deps --name stalwart-apply -p 127.0.0.1:8080:8080 \
  -e STALWART_RECOVERY_MODE=1 -e STALWART_RECOVERY_ADMIN="admin:$P" stalwart
until curl -fs http://127.0.0.1:8080/healthz/ready >/dev/null; do sleep 2; done
export STALWART_URL=http://127.0.0.1:8080 STALWART_USER=admin STALWART_PASSWORD="$P"
sed "s/__RELAY_PASSWORD__/$(sed -n 's/^RELAY_PASSWORD=//p' .env)/" stalwart/plan.ndjson \
  | ./stalwart-cli apply --stdin
docker rm -f stalwart-apply
unset STALWART_URL STALWART_USER STALWART_PASSWORD
docker compose up -d stalwart
```

Пароль восстановления одноразовый: живёт только в этой сессии и в контейнере,
который тут же удаляется. Постоянный пароль восстановления — чёрный ход в
обход всех учёток.

План идемпотентен: повторный накат ничего не дублирует.

---

## Админка Stalwart

`https://mail.noova.fyi:8443/admin`, вход `admin@noova.fyi`.

Первым делом — 2FA для `admin`: админка открыта в интернет, а перебор паролей
Stalwart только замедляет баном.

Здесь заводятся ящики и алиасы. **Отправлять с адреса можно, только если он
принадлежит учётке** — основной адрес или алиас. Чтобы `support@noova.fyi`
мог писать от `support@noova.cc`, добавь этой учётке алиас `support` на
домене noova.cc.

## Веб-почта

`https://webmail.noova.fyi`, вход полным адресом ящика и его паролем.

**Отправить от второго адреса.** В админке Stalwart алиас у учётки (см. выше),
затем в Roundcube: Настройки → Идентификаторы → Создать, адрес алиаса. Дальше
адрес выбирается в поле «От кого» при написании письма.

**Перебор паролей.** Защита двухслойная, и у каждого слоя есть предел:

- Roundcube после трёх неудачных входов закрывает ящик на минуту — но только
  ящик, который уже входил в веб-почту: счётчик хранится в его записи в базе
  Roundcube. Для остальных этот слой не работает.
- Stalwart видит все входы через веб-почту с одного адреса — адреса Roundcube —
  и после 100 неудачных за сутки банит его на сутки. **Веб-почта при этом не
  пускает никого**, с любым паролем: «Connection to storage server failed».
  Почтовые клиенты (IMAP, SMTP) и письма сайта продолжают работать. Снять
  раньше — раздел «Разбан».

Входы видны в логе вместе с адресом посетителя:

```bash
docker compose logs roundcube | grep userlogins     # X-Forwarded-For — это посетитель
```

**Почтовый клиент** вместо веб-почты:

| | |
|---|---|
| IMAP | `mail.noova.fyi`, 993, SSL/TLS |
| SMTP | `mail.noova.fyi`, 465, SSL/TLS |
| Логин | полный адрес |

Письма отправителей без SPF и DKIM антиспам кладёт в «Junk Mail».

---

## Разбан

Бан снимается сам через сутки. Раньше — в режиме восстановления, почта стоит
около минуты:

```bash
cd ~/relay
docker compose stop stalwart
P="$(openssl rand -hex 24)"
docker compose run -d --no-deps --name stalwart-apply -p 127.0.0.1:8080:8080 \
  -e STALWART_RECOVERY_MODE=1 -e STALWART_RECOVERY_ADMIN="admin:$P" stalwart
until curl -fs http://127.0.0.1:8080/healthz/ready >/dev/null; do sleep 2; done
export STALWART_URL=http://127.0.0.1:8080 STALWART_USER=admin STALWART_PASSWORD="$P"
./stalwart-cli query BlockedIp                   # адрес, причина, до какого времени
./stalwart-cli delete BlockedIp --ids <id>
docker rm -f stalwart-apply
unset STALWART_URL STALWART_USER STALWART_PASSWORD
docker compose up -d stalwart
```

Без остановки почты — тем же CLI на работающем сервере, под учёткой
администратора (`STALWART_URL=https://127.0.0.1:8443`, ключ `-k`). Тогда
после удаления записи нужно ещё действие перезагрузки списка — иначе бан
держится до перезапуска:

```bash
printf '%s\n' '{"@type":"create","object":"Action","value":{"a":{"@type":"ReloadBlockedIps"}}}' \
  | ./stalwart-cli -k apply --stdin
```

---

## Проверка

```bash
docker compose ps                                        # на релее: caddy, stalwart, roundcube
docker compose exec smtp postqueue -p                    # на Prod: пусто
curl -sI https://webmail.noova.fyi | head -1             # 200
timeout 8 bash -c 'exec 3<>/dev/tcp/mail.noova.fyi/25 && head -1 <&3'   # снаружи, не с Prod
```

Последняя строка — с машины, где исходящий 25-й открыт; ответ
`220 mail.noova.fyi Stalwart ESMTP`. Затем регистрация на сайте и письмо из
веб-почты с каждого домена на Gmail: в заголовках `dkim=pass` и `dmarc=pass`.
Финально — `mail-tester.com`.

---

## Если что-то не так

| Симптом | Причина |
|---|---|
| в логе Stalwart `build-error` | не читается файл: ключ DKIM или сертификат не в группе 2000 |
| на Prod `lost connection` сразу после AUTH | IP Prod сменился, а в плане старый |
| на Prod `authentication failed` | `RELAY_PASSWORD` на Prod и на релее разошлись |
| на Prod `certificate verify failed` | в `RELAY_HOST` IP вместо имени, или сертификат не выпущен |
| `Connection refused` на Prod | ufw на релее не пускает, или сервер не поднят |
| `Connection timed out` в логе Stalwart | исходящий 25-й закрыт у провайдера релея |
| `You are not allowed to send from this address` | у учётки нет этого адреса ни основным, ни алиасом |
| веб-почта у всех: `Connection to storage server failed` | Stalwart забанил адрес Roundcube после серии неудачных входов — «Разбан»; либо сертификат Stalwart просрочен — `docker compose logs roundcube` |
| веб-почта: `Too many failed login attempts` | у этого ящика три неудачных входа за минуту — подождать минуту |
| всех выкидывает из веб-почты после пересоздания контейнера | нет `ROUNDCUBE_DES_KEY` в `.env` |
| админка после входа уводит на странный адрес | не задан `STALWART_PUBLIC_URL` |
| `docker compose logs stalwart` пуст | план не накатан |
| письма с `@noova.cc` отклоняются | нет SPF или DKIM у noova.cc, а там DMARC `p=reject` |
| уходят, но в спам | PTR/SPF/DKIM или репутация нового домена — прогрев |
| встало через ~3 месяца | сертификат, проверить хук продления |

## Обслуживание

```bash
sudo certbot renew --dry-run                 # на релее
```

**Обновить Stalwart.** Прочитать `UPGRADING` в репозитории Stalwart — между
версиями менялся формат настроек. Потом тег в compose, `docker compose pull
stalwart` и «Накатить план».

**Обновить Roundcube.** Тег в compose, `docker compose pull roundcube &&
docker compose up -d roundcube`. Исправления безопасности выходят часто — не
откладывать.

Первые недели объём наращивать постепенно. Периодически проверять IP на
`check.spamhaus.org`.

## Возврат к прямой отправке

Удалить четыре строки `RELAY_*` из `~/noova/.env`, вернуть `A mail.<домен>` и
`ip4:` в SPF на IP Prod, запросить там PTR, перенести ключ обратно. Приём
почты, ящики и веб-почта при этом остаются на релее.

Если это делается заодно с переездом Prod на новую машину (у нового
провайдера уже открыт исходящий 25-й) — не вручную, а
`make migrate-server ... DIRECT_MAIL=1`: он же чистит `RELAY_*` из `.env`,
переносит ключ DKIM и печатает те же три записи DNS. Подробнее —
[migration.md](migration.md), §2а.
