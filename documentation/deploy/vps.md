# Машины

Три VPS. Backup нужен всегда, SMTP — только если провайдер Prod держит
исходящий 25-й закрытым.

| | Что делает | Открыто наружу |
|---|---|---|
| **Prod** | сайт, API, база, фотографии | 22, 80, 443 |
| **SMTP** | отправка писем | 22, 587 (только с Prod) |
| **Backup** | снимает, проверяет и хранит копии | 22 |

Провайдеру до оплаты подтвердить письмом: открытый исходящий 25-й,
разрешённый adult, юрисдикция ЕС/ЕЭЗ (L-09).

---

## Общее для всех трёх

```bash
ssh-copy-id -i ~/.ssh/<ключ>.pub root@<IP>   # первым делом, пока пароль принимают
ssh root@<IP> 'echo ok'                      # должно пустить БЕЗ пароля
```

Без ключа `server-setup` откажется выключать пароли — иначе запер бы машину
снаружи. Это единственная неисправимая по сети ошибка.

Проверять вход **вторым окном**, не закрывая текущее.

---

## Prod

```bash
ssh -t root@<IP> 'adduser --disabled-password --gecos "" deploy; passwd deploy'
make server-setup SERVER=root@<IP>
ssh deploy@<IP> 'sudo -v && docker ps'       # вторым окном
```

Пароль задаётся до скрипта: он закрывает вход root'ом, и `passwd` выполнить
будет уже нечем.

### DNS

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | IP Prod |
| A | `mail` | IP отправителя писем |
| TXT | `@` | `v=spf1 ip4:<IP отправителя> ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<ящик вне домена>` |
| TXT | `mail._domainkey` | из контейнера, после первого запуска |
| MX | `@` | пересылка, если публикуете адрес поддержки |

```bash
dig +short A <домен> @1.1.1.1                # публичный резолвер, локальный подменяет
```

- **`AAAA` не добавлять**, пока IPv6 не настроен: Let's Encrypt проверяет его
  первым и не выпустит сертификат вовсе.
- SPF-запись **одна**: две `v=spf1` дают `permerror`.
- `rua` — ящик **вне** этого домена.

---

## SMTP

Нужен, только если на Prod закрыт исходящий 25-й. Проверить:

```bash
timeout 8 bash -c 'exec 3<>/dev/tcp/aspmx.l.google.com/25 && head -1 <&3'
```

`220 ... ESMTP` — открыт, машина не нужна. Молчание — заводите.

```bash
# IP проверить на check.spamhaus.org, в списках — просить замену
ssh -t root@<IP релея> 'adduser --disabled-password --gecos "" deploy; passwd deploy'
make server-setup SERVER=root@<IP релея>
ssh deploy@<IP релея> 'sudo ufw allow from <IP Prod> to any port 587 proto tcp'
```

Submission только с Prod: открытый всему миру находят за часы.

PTR → `mail.<домен>`, в панели провайдера или заявкой. Имя должно совпадать в
трёх местах: HELO, PTR, A-запись.

Дальше — [smtp.md](smtp.md).

---

## Backup

```bash
make server-setup SERVER=root@<IP> ROLE=storage
ssh deploy@<IP> 'echo ok'                    # вторым окном
```

`ROLE=storage` — без Docker и без 80/443, ставит `cron`, `openssl`, `curl`.
Пароль для sudo не нужен: в работе копий он не участвует.

Дальше — [backup.md](backup.md).
