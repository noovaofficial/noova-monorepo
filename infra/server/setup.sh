#!/usr/bin/env bash
#
# Подготовка чистого сервера: пользователь, SSH, периметр, своп и — для
# прикладной машины — Docker. Повторяет шаги 1–5 из
# documentation/deploy/server.md §3.
#
#   ssh root@<IP> 'bash -s' < infra/server/setup.sh
#   ssh root@<IP> 'ROLE=storage bash -s' < infra/server/setup.sh
#
# Две роли, потому что машины разные:
#
#   app     (по умолчанию) — здесь работает стек: нужен Docker, открыты 80 и 443.
#   storage — машина-хранилище копий: ни контейнеров, ни веб-портов. Docker ей
#             не нужен (проверка копий идёт потоком, без Postgres), а лишний
#             открытый порт на машине, где лежит закрытый ключ шифрования, —
#             это площадь атаки в обмен ни на что.
#
# Шага 0 здесь нет намеренно: свой ключ на сервер кладут ДО запуска этого
# скрипта, командой `ssh-copy-id`. Иначе скрипт выключит парольный вход, а
# ключа для нового пользователя не окажется — и машина закроется снаружи.
# Скрипт это проверяет и отказывается работать вслепую.
#
# Идемпотентен: повторный запуск на настроенной машине ничего не ломает.
set -euo pipefail

USER_NAME="${DEPLOY_USER:-deploy}"
SWAP_MB="${SWAP_MB:-2048}"
ROLE="${ROLE:-app}"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запускать от root: ssh root@<IP> 'bash -s' < infra/server/setup.sh"
case "$ROLE" in
  app|storage) ;;
  *) fail "ROLE=$ROLE — допустимо app или storage" ;;
esac

# ---------------------------------------------------------------------------
# Проверка до изменений: есть ли чем заходить после того, как пароли выключат.
# ---------------------------------------------------------------------------
say "Проверки"
ROOT_KEYS="${HOME:-/root}/.ssh/authorized_keys"
if [ ! -s "$ROOT_KEYS" ]; then
  fail "У root нет ~/.ssh/authorized_keys.
  Сначала, со своей машины: ssh-copy-id -i ~/.ssh/<ключ>.pub root@<IP>
  Без этого скрипт выключит парольный вход, и зайти будет нечем."
fi
ok "ключ root на месте ($(grep -c . "$ROOT_KEYS") шт.), роль: $ROLE"

# ---------------------------------------------------------------------------
say "1. Пользователь $USER_NAME"
if id "$USER_NAME" >/dev/null 2>&1; then
  ok "уже существует"
else
  adduser --disabled-password --gecos '' "$USER_NAME"
  ok "создан"
fi
usermod -aG sudo "$USER_NAME"

# Пароль нужен для sudo. Задать его должен человек — генерировать втайне
# значит оставить учётку с паролем, которого никто не знает.
if passwd -S "$USER_NAME" | awk '{print $2}' | grep -qE '^(L|NP)$'; then
  printf '  ! Пароль для sudo не задан. После скрипта: passwd %s\n' "$USER_NAME"
fi

install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
install -m 600 -o "$USER_NAME" -g "$USER_NAME" "$ROOT_KEYS" "/home/$USER_NAME/.ssh/authorized_keys"
ok "ключи скопированы пользователю"

# ---------------------------------------------------------------------------
say "2. SSH: закрываем root и пароли"
# Значение, а не комментарий: закомментированная директива возвращает
# умолчание OpenSSH, а оно здесь противоположно нужному —
# PermitRootLogin → prohibit-password, PasswordAuthentication → yes.
CONF=/etc/ssh/sshd_config.d/00-noova.conf
BACKUP="$CONF.before-noova"
install -d -m 755 /etc/ssh/sshd_config.d
[ -f "$CONF" ] && cp "$CONF" "$BACKUP"
cat > "$CONF" <<'EOF'
# Правила Noova. Отдельным файлом в sshd_config.d, а не правкой основного:
# в sshd побеждает ПЕРВОЕ встреченное значение, а Include стоит в начале
# sshd_config — значит правка основного файла ниже по тексту не применилась бы.
# Имя с префиксом 00- ставит файл перед провайдерским 50-cloud-init.conf.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
chmod 644 "$CONF"

# Если проверка не прошла — убираем свой файл. Оставить непроверенную
# конфигурацию значит подложить мину: сама она ничего не сломает, но
# следующий перезапуск sshd поднимет её и может закрыть доступ.
if ! sshd -t 2>/tmp/sshd-check.log; then
  if [ -f "$BACKUP" ]; then mv "$BACKUP" "$CONF"; else rm -f "$CONF"; fi
  fail "Конфигурация sshd не проходит проверку, изменения отменены:
$(cat /tmp/sshd-check.log)"
fi
rm -f "$BACKUP"
systemctl reload ssh 2>/dev/null || systemctl reload sshd
for setting in permitrootlogin passwordauthentication kbdinteractiveauthentication; do
  value="$(sshd -T | awk -v k="$setting" '$1==k {print $2}')"
  [ "$value" = "no" ] || fail "$setting = $value, ожидалось no"
done
ok "root и пароли закрыты, проверено по sshd -T"

# ---------------------------------------------------------------------------
say "3. Docker"
if [ "$ROLE" = storage ]; then
  # Хранилищу контейнеры не нужны: снимок приходит потоком, а проверка копии
  # обходится openssl, gzip и tar. Ставить сюда Docker значит расширять
  # поверхность машины ради ничего.
  ok "роль storage — пропускаю"
elif command -v docker >/dev/null 2>&1; then
  ok "уже установлен ($(docker --version))"
else
  curl -fsSL https://get.docker.com | sh
  ok "установлен"
fi
if [ "$ROLE" = app ]; then
  usermod -aG docker "$USER_NAME"
  ok "$USER_NAME добавлен в группу docker"
fi

# Хранилищу нужны cron (расписание снимков), openssl (шифрование и проверка)
# и curl (пинг монитору). На минимальных образах их может не быть, а узнается
# это далеко не сразу — первой пропущенной ночью.
if [ "$ROLE" = storage ]; then
  MISSING=""
  for C in crontab openssl curl; do
    command -v "$C" >/dev/null 2>&1 || MISSING="$MISSING $C"
  done
  if [ -n "$MISSING" ]; then
    apt-get update -qq
    # crontab лежит в пакете cron — имена не совпадают.
    apt-get install -y -qq $(printf '%s' "$MISSING" | sed 's/crontab/cron/') >/dev/null
    systemctl enable --now cron >/dev/null 2>&1 || true
    ok "доустановлено:$MISSING"
  else
    ok "cron, openssl и curl на месте"
  fi
fi

# ---------------------------------------------------------------------------
say "4. Периметр"
# Порт 25 наружу нужен исходящий — входящий не нужен: контейнер smtp только
# отправляет и портов не публикует.
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null
  if [ "$ROLE" = app ]; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    OPENED="открыты 22, 80, 443"
  else
    # Хранилище ничего не публикует: оно само ходит на прод по ssh.
    OPENED="открыт только 22"
  fi
  ufw --force enable >/dev/null
  ok "$OPENED"
else
  printf '  ! ufw не установлен — периметр не настроен\n'
fi

# ---------------------------------------------------------------------------
say "5. Своп"
if swapon --show | grep -q .; then
  ok "уже есть: $(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
else
  # dd, а не fallocate: он есть везде и корректно работает на btrfs.
  dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB" status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "создан ${SWAP_MB} МБ"
fi

# ---------------------------------------------------------------------------
printf '\n\033[32mМашина готова (роль %s).\033[0m Дальше:\n' "$ROLE"
printf '  1. passwd %s          — пароль для sudo, если ещё не задан\n' "$USER_NAME"
printf '  2. ssh %s@<IP>        — проверить ВТОРЫМ окном, не закрывая текущее\n' "$USER_NAME"
if [ "$ROLE" = app ]; then
  printf '  3. .env на сервере    — infra/server/make-env.sh\n'
else
  printf '  3. make backup-storage STORAGE=%s@<IP> SERVER=deploy@<прод> KEY=~/noova-backup/backup-private.pem\n' "$USER_NAME"
fi
