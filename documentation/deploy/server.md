# Сервер

Разовая подготовка до первого выпуска.
Дальше — [release.md](release.md), [mail.md](mail.md), [entryPoint.md](entryPoint.md).

---

## 1. Что нужно снаружи

База, Redis, MinIO и TLS — внутри стека. Снаружи:

| | Стенд | Прод |
|---|---|---|
| Домен и DNS | нужен | нужен |
| Сервер | 4 ГБ / 2 vCPU | 8 ГБ / 4 vCPU |
| Исходящий порт 25 | нужен | нужен |
| PTR | желателен | нужен |
| SPF, DKIM, DMARC | желательны | нужны |
| Тайл-сервер карт | можно без | нужен (L-06) |
| Бэкапы вне сервера | желательно | обязательно |

**Провайдер.** До оплаты подтвердить письмом: открытый исходящий 25-й,
разрешённый adult в условиях, юрисдикция ЕС/ЕЭЗ (L-09 в `legal.md`).

**Njalla** регистрирует домен на себя — в реестре владелец не вы.

### Записи DNS

| Тип | Имя | Значение | Когда |
|---|---|---|---|
| A | `@` | IPv4 сервера | сразу |
| A | `mail` | IPv4 отправителя писем | сразу |
| TXT | `@` | `v=spf1 ip4:<IP отправителя> ~all` | сразу |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<ящик вне домена>` | сразу |
| TXT | `mail._domainkey` | из контейнера | после первого запуска, §4 |
| MX | `@` | пересылка, если публикуете адрес поддержки | сразу |

- SPF-запись **одна**: две `v=spf1` дают `permerror`.
- `rua` — ящик **вне** этого домена.
- **`AAAA` не добавлять**, пока IPv6 не настроен: Docker без явной настройки
  по IPv6 не слушает, Let's Encrypt проверяет его первым и не выпустит
  сертификат вовсе, PTR ставится на один адрес.

Проверять через публичный резолвер — локальный может подменять:

```bash
dig +short A mail.<домен> @1.1.1.1
```

---

## 2. Мощности

Восемь контейнеров: postgres, redis, minio, api, web, caddy, smtp, jobs.
Копии на сервере не хранятся и отдельного контейнера под них нет — снимок
забирает машина-хранилище потоком (см. entryPoint.md).

- **RAM 4 ГБ — минимум.** `api` ограничен 768 МБ, Next 200–300 МБ, Postgres
  и MinIO по 256 МБ, sharp даёт всплески. На 2 ГБ начнёт свопить.
- **Диск.** ~6 МБ на анкету. Тысяча анкет ≈ 6 ГБ плюс дампы; 80 ГБ NVMe хватит.

---

## 3. Подготовка сервера

```bash
# 0. Ключ — руками и первым делом, пока пароль ещё принимается
ssh-copy-id -i ~/.ssh/<ключ>.pub root@<IP>
ssh root@<IP>                       # должно пустить БЕЗ пароля

# пароль для sudo — ДО скрипта, пока root ещё пускают
ssh -t root@<IP> 'adduser --disabled-password --gecos "" deploy; passwd deploy'

# 1–5
make server-setup SERVER=root@<IP>
```

Пользователь здесь создаётся руками только ради пароля: скрипт выключает
`PermitRootLogin`, и войти root'ом, чтобы выполнить `passwd`, будет уже
нельзя, а `sudo` у самого `deploy` без пароля не сработает. Повторное создание
скрипту не мешает — он видит существующего пользователя и идёт дальше.
Если момент упущен, останется только консоль провайдера. Машине-хранилищу
пароль не нужен вовсе: в её работе `sudo` не участвует.

Тем же скриптом готовится и машина-хранилище копий, только с другой ролью:

```bash
make server-setup SERVER=root@<IP хранилища> ROLE=storage
```

`ROLE=storage` даёт то же самое — пользователь `deploy`, вход только по ключу,
своп — но без Docker и без 80/443: контейнеров там нет, публиковать нечего, а
на машине с закрытым ключом шифрования лишний открытый порт ничем не окупается.
Вместо Docker доставляются `cron`, `openssl` и `curl`.

Шаг 0 ручной: без ключа у root скрипт откажется выключать пароли. Иначе он
запер бы машину снаружи — единственная неисправимая по сети ошибка.

Проверять **вторым окном**, не закрывая текущее:

```bash
ssh deploy@<IP> && sudo -v && docker ps
```

`sudo -v` не формальность: без пароля у `deploy` и с `PermitRootLogin no`
машина останется без пути к правам.

### То же вручную

```bash
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Своп — страховка от всплесков sharp, иначе их встречает OOM-killer.

### SSH: два подвоха

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

- **Менять значение, а не комментировать.** Умолчания OpenSSH противоположны
  нужному. Третья строка обязательна: иначе пароль принимается через PAM.
- **`Include` в начале `sshd_config` перекрывает правку.** Провайдеры кладут
  в `/etc/ssh/sshd_config.d/` файлы с `PasswordAuthentication yes`, побеждает
  первое встреченное значение.

```bash
grep -rE 'PermitRootLogin|PasswordAuthentication' /etc/ssh/sshd_config.d/
sshd -t
sshd -T | grep -E 'permitrootlogin|passwordauthentication|kbdinteractive'   # ждём no
systemctl restart ssh
```

### Вход потерян

`Permission denied (publickey)` под обоими пользователями = шаг 0 пропущен.
В открытой сессии, если осталась:

```bash
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo '<ваш .pub>' >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
```

Сессии нет — консоль в панели провайдера (VNC), она идёт мимо SSH.

---

## 4. Почта

Свой Postfix в контейнере `smtp` (N-15). Без почты не пройти регистрацию.

```bash
# 1. Репутация IP — до всего остального: check.spamhaus.org

# 2. Исходящий 25-й
timeout 8 bash -c 'exec 3<>/dev/tcp/aspmx.l.google.com/25 && head -1 <&3'
#    220 ... ESMTP — открыт, молчание — закрыт

# 3. PTR → mail.<домен>, у провайдера или в панели
dig +short -x <IP> @1.1.1.1

# 4. DNS — таблица в §1

# 5. DKIM
docker compose exec smtp ls -la /etc/opendkim/keys/
docker compose exec smtp cat /etc/opendkim/keys/<домен>.txt
```

Файлы лежат плоско (`<домен>.private`, `<домен>.txt`). В DNS идёт
`mail._domainkey` со значением из **склеенных подряд** кусков в кавычках —
без кавычек, скобок и комментария после `;`.

**Проверка:** регистрация на сайте → письмо не в спаме → `mail-tester.com`.

**Если 25-й не откроют** — Postfix переезжает на вторую машину,
[mail.md](mail.md).
