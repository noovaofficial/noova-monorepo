#!/usr/bin/env python3
"""
Бот резервных копий. Работает НА ХРАНИЛИЩЕ как постоянный процесс (ставит
bot-setup.sh), только стандартная библиотека Python 3.

Команды (в группе PULL_TG_CHAT, только для пользователей из PULL_TG_ADMINS):

  /list              что лежит в ~/backups: дата, размеры, статус проверки, роль
  /backup            запустить pull.sh прямо сейчас (итог придёт обычным сообщением)
  /verify [метка]    проверить копию (по умолчанию самую свежую)
  /disk              сколько места на диске хранилища и на сколько копий хватит
  /help              список команд

Что бот НЕ умеет и не должен уметь: расшифровывать, отдавать файлы, удалять.
Он запускает только уже существующие pull.sh и storage-verify.sh и читает
список каталога. Машина хранит закрытый ключ шифрования копий, поэтому
всё лишнее здесь — риск, и утечка токена бота не должна давать ничего,
кроме лишнего запуска бэкапа.

Связь с Telegram — long polling (getUpdates): входящих портов не нужно.
Пустой PULL_TG_ADMINS — бот отказывается стартовать: команды «для всех в
группе» запускать не будем.
"""

import fcntl
import html
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ANSI = re.compile(r"\x1b\[[0-9;]*m")
STAMP_RE = re.compile(r"^\d{8}T\d{6}Z$")

# Коды возврата pull.sh: 75 — занято другим запуском (EX_TEMPFAIL).
EXIT_BUSY = 75


# --- настройки ---------------------------------------------------------------


def parse_env(text):
    """KEY=VALUE построчно, как в ~/noova-pull.env. Комментарии и пустые строки пропускаются."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key.strip()] = value
    return out


def parse_admins(raw):
    """«123, 456» -> {123, 456}. Мусор в списке — не молча пропускаем, а ошибка:
    опечатка в id не должна выглядеть как «доступ есть, но не у меня»."""
    ids = set()
    for part in (raw or "").replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        if not re.fullmatch(r"-?\d+", part):
            raise ValueError(f"PULL_TG_ADMINS: «{part}» не похоже на числовой user id")
        ids.add(int(part))
    return ids


class Config:
    def __init__(self, env):
        home = os.path.expanduser("~")
        expand = lambda v: os.path.expanduser(os.path.expandvars(v))  # noqa: E731
        self.token = env.get("PULL_TG_TOKEN", "")
        self.chat = int(env["PULL_TG_CHAT"]) if env.get("PULL_TG_CHAT") else None
        self.admins = parse_admins(env.get("PULL_TG_ADMINS", ""))
        self.dest = expand(env.get("PULL_DEST", os.path.join(home, "backups")))
        self.lock = expand(env.get("PULL_LOCK", os.path.join(home, ".noova-pull.lock")))
        self.cooldown = int(env.get("PULL_BOT_COOLDOWN_MIN", "10")) * 60
        self.pull = os.path.join(HERE, "pull.sh")
        self.verify = os.path.join(HERE, "storage-verify.sh")

    def problems(self):
        out = []
        if not self.token:
            out.append("не задан PULL_TG_TOKEN")
        if self.chat is None:
            out.append("не задан PULL_TG_CHAT")
        if not self.admins:
            out.append("не задан PULL_TG_ADMINS (кому разрешены команды)")
        return out


# --- форматирование ----------------------------------------------------------


def human_size(b):
    if b < 1024:
        return f"{b} B"
    if b < 1024**2:
        return f"{b / 1024:.0f} KB"
    if b < 1024**3:
        v = b / 1024**2
        return f"{v:.1f} MB" if v < 10 else f"{v:.0f} MB"
    return f"{b / 1024**3:.1f} GB"


def human_age(seconds):
    if seconds < 90:
        return "только что"
    m = seconds // 60
    if m < 60:
        return f"{m} мин назад"
    h, m = divmod(m, 60)
    if h < 24:
        return f"{h} ч {m} мин назад"
    d, h = divmod(h, 24)
    return f"{d} д {h} ч назад"


def stamp_dt(stamp):
    return datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def stamp_pretty(stamp):
    return stamp_dt(stamp).strftime("%d.%m.%Y %H:%M UTC")


def esc(text):
    return html.escape(str(text), quote=False)


# --- копии на диске ----------------------------------------------------------


def list_backups(dest):
    """Полные копии (дамп + фотографии), от свежих к старым."""
    try:
        names = os.listdir(dest)
    except FileNotFoundError:
        return []
    entries = []
    for name in names:
        m = re.fullmatch(r"noova-(\d{8}T\d{6}Z)\.sql\.gz\.enc", name)
        if not m:
            continue
        stamp = m.group(1)
        media = os.path.join(dest, f"noova-media-{stamp}.tar.gz.enc")
        if not os.path.exists(media):
            continue
        if os.path.exists(os.path.join(dest, f"noova-{stamp}.bad")):
            status = "bad"
        elif os.path.exists(os.path.join(dest, f"noova-{stamp}.ok")):
            status = "ok"
        else:
            status = "unchecked"
        entries.append(
            {
                "stamp": stamp,
                "db": os.path.getsize(os.path.join(dest, name)),
                "media": os.path.getsize(media),
                "status": status,
            }
        )
    entries.sort(key=lambda e: e["stamp"], reverse=True)
    return entries


def read_rotation(dest):
    """Разбивка по ролям, которую пишет storage-prune.sh; нет файла — None."""
    try:
        with open(os.path.join(dest, ".rotation")) as f:
            env = parse_env(f.read())
        return {k: int(env.get(k, "0")) for k in ("daily", "weekly", "monthly")}
    except (FileNotFoundError, ValueError):
        return None


def role_of(index, rotation):
    """Свежие — ежедневные, затем недельная, затем месячная (так их оставляет ротация)."""
    if not rotation:
        return ""
    if index < rotation["daily"]:
        return "ежедневная"
    index -= rotation["daily"]
    if index < rotation["weekly"]:
        return "недельная"
    index -= rotation["weekly"]
    if index < rotation["monthly"]:
        return "месячная"
    return ""


STATUS = {"ok": "✅ пригодна", "bad": "❌ не прошла проверку", "unchecked": "⏳ не проверена"}


def render_list(entries, rotation, now):
    if not entries:
        return "<b>Backup Noova: Копий нет ❌</b>"
    lines = [f"<b>Backup Noova: Копии на хранилище — {len(entries)}</b>"]
    if rotation:
        lines[0] += (
            f" (ежедневных: {rotation['daily']}, недельных: {rotation['weekly']}, "
            f"месячных: {rotation['monthly']})"
        )
    for i, e in enumerate(entries):
        age = human_age(int((now - stamp_dt(e["stamp"])).total_seconds()))
        role = role_of(i, rotation)
        head = f"{i + 1}. <b>{stamp_pretty(e['stamp'])}</b>"
        if role:
            head += f" — {role}"
        lines.append(
            f"{head}\n"
            f"    {STATUS[e['status']]} · {age}\n"
            f"    База: <b>{human_size(e['db'])}</b> · Фото: <b>{human_size(e['media'])}</b>"
        )
    return "\n".join(lines)


def disk_report(dest, entries):
    """Свободное место на диске хранилища. Показываем не только «сколько ГБ», но и
    «на сколько ночей хватит»: гигабайты без привязки к размеру копии ничего не
    говорят, а когда копий помещается меньше двух, откат уже под вопросом."""
    path = dest if os.path.isdir(dest) else os.path.expanduser("~")
    usage = shutil.disk_usage(path)
    free_pct = usage.free / usage.total * 100
    backups = 0
    for name in os.listdir(dest) if os.path.isdir(dest) else []:
        if name.startswith("noova-"):
            backups += os.path.getsize(os.path.join(dest, name))

    lines = []
    fits = None
    if entries:
        last = entries[0]["db"] + entries[0]["media"]
        fits = int(usage.free // last) if last else None
    if free_pct < 5 or (fits is not None and fits < 2):
        head = "Диск: место заканчивается ❌"
    elif free_pct < 15 or (fits is not None and fits < 5):
        head = "Диск: места мало ⚠️"
    else:
        head = "Диск ✅"
    lines.append(f"<b>Backup Noova: {head}</b>")
    lines.append(
        f"Свободно: <b>{human_size(usage.free)}</b> из {human_size(usage.total)} ({free_pct:.0f}%)"
    )
    lines.append(f"Занято копиями: <b>{human_size(backups)}</b> ({len(entries)} шт.)")
    if fits is not None:
        lines.append(
            f"Ещё поместится копий: <b>~{fits}</b> (по размеру последней, "
            f"{human_size(entries[0]['db'] + entries[0]['media'])})"
        )
    return "\n".join(lines)


HELP = (
    "<b>Backup Noova: Команды</b>\n"
    "/list — какие копии есть на хранилище\n"
    "/backup — снять копию прямо сейчас\n"
    "/verify [метка] — проверить копию (по умолчанию самую свежую)\n"
    "/disk — сколько свободного места на диске хранилища\n"
    "/help — эта справка"
)


# --- разбор входящего --------------------------------------------------------


def parse_command(text, bot_username=None):
    """«/list@noova_bot arg» -> ('list', 'arg'). Команда, адресованная другому боту, — (None, '')."""
    if not text or not text.startswith("/"):
        return None, ""
    head, _, rest = text.partition(" ")
    cmd, _, target = head[1:].partition("@")
    if target and bot_username and target.lower() != bot_username.lower():
        return None, ""
    return cmd.lower(), rest.strip()


def authorized(message, chat, admins):
    """Команду принимаем только из нашей группы и только от перечисленных людей."""
    return (
        message.get("chat", {}).get("id") == chat
        and message.get("from", {}).get("id") in admins
    )


def summarize_verify(output):
    """Из вывода storage-verify.sh оставляем содержательные строки (✓ / ! / ✗)."""
    lines = []
    for raw in ANSI.sub("", output).splitlines():
        line = raw.strip()
        if line[:1] in ("✓", "!", "✗"):
            lines.append(line)
    return lines


# --- блокировка --------------------------------------------------------------


class Busy(Exception):
    pass


class FileLock:
    """Та же блокировка, что берёт pull.sh (flock на одном файле): проверка не должна
    идти одновременно со снятием копии и ротацией."""

    def __init__(self, path):
        self.path = path
        self.f = None

    def __enter__(self):
        self.f = open(self.path, "w")
        try:
            fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.f.close()
            raise Busy() from None
        return self

    def __exit__(self, *exc):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


# --- бот ---------------------------------------------------------------------


class Bot:
    def __init__(self, cfg, api=None):
        self.cfg = cfg
        self._api = api or self._telegram
        self.username = None
        self.offset = None
        self.last_backup = 0.0
        self.running = {"backup": False, "verify": False}

    def _telegram(self, method, **params):
        url = f"https://api.telegram.org/bot{self.cfg.token}/{method}"
        data = urllib.parse.urlencode(params).encode()
        timeout = int(params.get("timeout", 0)) + 15
        with urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=timeout) as r:
            body = json.load(r)
        if not body.get("ok"):
            raise RuntimeError(body.get("description", "Telegram вернул ошибку"))
        return body["result"]

    def send(self, text, reply_to=None):
        params = {"chat_id": self.cfg.chat, "text": text, "parse_mode": "HTML"}
        if reply_to:
            params["reply_to_message_id"] = reply_to
        try:
            self._api("sendMessage", **params)
        except Exception as e:  # noqa: BLE001 — не падаем из-за одной неудачной отправки
            log(f"не удалось отправить: {e}")

    def handle(self, message):
        """Один вход из группы. Возвращает True, если команда распознана и разрешена."""
        text = message.get("text") or ""
        cmd, arg = parse_command(text, self.username)
        if cmd is None:
            return False
        if not authorized(message, self.cfg.chat, self.cfg.admins):
            # Молча: отвечать чужим значит подтверждать, что здесь что-то есть.
            log(f"игнор /{cmd} от {message.get('from', {}).get('id')} в {message.get('chat', {}).get('id')}")
            return False
        reply_to = message.get("message_id")
        if cmd in ("start", "help"):
            self.send(HELP, reply_to)
        elif cmd == "list":
            self.send(render_list(list_backups(self.cfg.dest), read_rotation(self.cfg.dest), datetime.now(timezone.utc)), reply_to)
        elif cmd in ("disk", "space"):
            self.send(disk_report(self.cfg.dest, list_backups(self.cfg.dest)), reply_to)
        elif cmd == "backup":
            self.start_backup(reply_to)
        elif cmd == "verify":
            self.start_verify(arg, reply_to)
        else:
            return False
        return True

    def start_backup(self, reply_to):
        if self.running["backup"]:
            self.send("<b>Backup Noova: Уже идёт ⏳</b>\nСнятие копии ещё не закончено.", reply_to)
            return
        wait = self.last_backup + self.cfg.cooldown - time.time()
        if wait > 0:
            self.send(
                f"<b>Backup Noova: Слишком часто ⏳</b>\nСледующий запуск через <b>{int(wait // 60) + 1} мин</b> "
                "(защита от лишней нагрузки на прод).",
                reply_to,
            )
            return
        self.last_backup = time.time()
        self.running["backup"] = True
        self.send("<b>Backup Noova: Запускаю копирование ⏳</b>\nИтог придёт отдельным сообщением.", reply_to)
        threading.Thread(target=self._run_backup, args=(reply_to,), daemon=True).start()

    def _run_backup(self, reply_to):
        try:
            # PULL_LOCK_WAIT=0: если уже идёт ночной цикл, не ждём, а сообщаем.
            env = {**os.environ, "PULL_LOCK_WAIT": "0"}
            r = subprocess.run(["bash", self.cfg.pull], env=env, capture_output=True, text=True, timeout=3600)
            if r.returncode == EXIT_BUSY:
                self.send("<b>Backup Noova: Занято ⏳</b>\nСейчас уже идёт другое копирование или проверка.", reply_to)
            elif r.returncode != 0:
                # Причину и состояние копий pull.sh уже отправил своим сообщением об ошибке.
                log(f"pull.sh завершился с кодом {r.returncode}")
        except subprocess.TimeoutExpired:
            self.send("<b>Backup Noova: Ошибка ❌</b>\nПричина: <b>копирование не уложилось в час</b>", reply_to)
        finally:
            self.running["backup"] = False

    def start_verify(self, arg, reply_to):
        entries = list_backups(self.cfg.dest)
        if arg and not STAMP_RE.match(arg):
            self.send("<b>Backup Noova: Ошибка ❌</b>\nМетка должна быть вида <b>20260924T041701Z</b> (см. /list).", reply_to)
            return
        stamp = arg or (entries[0]["stamp"] if entries else "")
        if not stamp or stamp not in {e["stamp"] for e in entries}:
            self.send("<b>Backup Noova: Ошибка ❌</b>\nТакой копии нет (см. /list).", reply_to)
            return
        if self.running["verify"]:
            self.send("<b>Backup Noova: Уже идёт ⏳</b>\nПроверка ещё не закончена.", reply_to)
            return
        self.running["verify"] = True
        self.send(f"<b>Backup Noova: Проверяю копию {stamp_pretty(stamp)} ⏳</b>", reply_to)
        threading.Thread(target=self._run_verify, args=(stamp, reply_to), daemon=True).start()

    def _run_verify(self, stamp, reply_to):
        try:
            try:
                with FileLock(self.cfg.lock):
                    r = subprocess.run(
                        ["bash", self.cfg.verify, stamp], capture_output=True, text=True, timeout=1800
                    )
            except Busy:
                self.send("<b>Backup Noova: Занято ⏳</b>\nСейчас идёт копирование или другая проверка.", reply_to)
                return
            lines = summarize_verify(r.stdout + "\n" + r.stderr)
            body = "\n".join(esc(line) for line in lines)
            if r.returncode == 0:
                self.send(f"<b>Backup Noova: Копия пригодна ✅</b>\n{stamp_pretty(stamp)}\n{body}", reply_to)
            else:
                # Так же, как pull.sh: копия, не прошедшая проверку, помечается .bad.
                with open(os.path.join(self.cfg.dest, f"noova-{stamp}.bad"), "w") as f:
                    f.write(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + "\n")
                self.send(f"<b>Backup Noova: Копия не прошла проверку ❌</b>\n{stamp_pretty(stamp)}\n{body}", reply_to)
        except subprocess.TimeoutExpired:
            self.send("<b>Backup Noova: Ошибка ❌</b>\nПричина: <b>проверка не уложилась в 30 минут</b>", reply_to)
        finally:
            self.running["verify"] = False

    def drain_backlog(self):
        """Команды, присланные, пока бот был выключен, не выполняем: «/backup» трёхчасовой
        давности не должен внезапно запуститься при старте."""
        updates = self._api("getUpdates", offset=-1, timeout=0)
        if updates:
            self.offset = updates[-1]["update_id"] + 1

    def run(self):
        self.username = self._api("getMe")["username"]
        self.drain_backlog()
        log(f"бот @{self.username} запущен; админов: {len(self.cfg.admins)}")
        backoff = 1
        while True:
            try:
                params = {"timeout": 50, "allowed_updates": json.dumps(["message"])}
                if self.offset is not None:
                    params["offset"] = self.offset
                for update in self._api("getUpdates", **params):
                    self.offset = update["update_id"] + 1
                    message = update.get("message")
                    if message:
                        self.handle(message)
                backoff = 1
            except (urllib.error.URLError, TimeoutError, RuntimeError, OSError) as e:
                log(f"getUpdates: {e}; повтор через {backoff} с")
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)


def log(message):
    print(f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {message}", flush=True)


def main():
    conf = os.environ.get("NOOVA_PULL_CONF", os.path.expanduser("~/noova-pull.env"))
    try:
        with open(conf) as f:
            cfg = Config(parse_env(f.read()))
    except (OSError, ValueError) as e:
        sys.exit(f"bot.py: не прочитать настройки {conf}: {e}")
    problems = cfg.problems()
    if problems:
        sys.exit("bot.py: " + "; ".join(problems) + f" — проверьте {conf}")
    Bot(cfg).run()


if __name__ == "__main__":
    main()
