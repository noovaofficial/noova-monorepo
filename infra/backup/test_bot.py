import os
import tempfile
import unittest
from datetime import datetime, timezone

import bot


def make_copy(dest, stamp, db=660_000, media=154_000_000, flag=None):
    for name, size in ((f"noova-{stamp}.sql.gz.enc", db), (f"noova-media-{stamp}.tar.gz.enc", media)):
        with open(os.path.join(dest, name), "wb") as f:
            f.truncate(size)
    if flag:
        open(os.path.join(dest, f"noova-{stamp}.{flag}"), "w").close()


class Fake:
    """Подмена Telegram API: копит отправленные сообщения."""

    def __init__(self):
        self.sent = []

    def __call__(self, method, **params):
        if method == "sendMessage":
            self.sent.append(params)
            return {}
        raise AssertionError(f"неожиданный вызов {method}")


def cfg(dest, admins="42"):
    return bot.Config(
        {"PULL_TG_TOKEN": "T", "PULL_TG_CHAT": "-100", "PULL_TG_ADMINS": admins, "PULL_DEST": dest}
    )


def msg(text, user=42, chat=-100, mid=7):
    return {"text": text, "from": {"id": user}, "chat": {"id": chat}, "message_id": mid}


class Parsing(unittest.TestCase):
    def test_env(self):
        env = bot.parse_env("# c\nA=1\nB = 'x y'\n\nC=\"z\"\nbad\n")
        self.assertEqual(env, {"A": "1", "B": "x y", "C": "z"})

    def test_admins(self):
        self.assertEqual(bot.parse_admins("1, 2;3"), {1, 2, 3})
        self.assertEqual(bot.parse_admins(""), set())
        with self.assertRaises(ValueError):
            bot.parse_admins("12, abc")

    def test_command(self):
        self.assertEqual(bot.parse_command("/List arg", "b"), ("list", "arg"))
        self.assertEqual(bot.parse_command("/list@b", "b"), ("list", ""))
        self.assertEqual(bot.parse_command("/list@other", "b"), (None, ""))
        self.assertEqual(bot.parse_command("привет", "b"), (None, ""))

    def test_authorized(self):
        self.assertTrue(bot.authorized(msg("/x"), -100, {42}))
        self.assertFalse(bot.authorized(msg("/x", user=1), -100, {42}))
        self.assertFalse(bot.authorized(msg("/x", chat=5), -100, {42}))

    def test_problems_when_no_admins(self):
        c = bot.Config({"PULL_TG_TOKEN": "T", "PULL_TG_CHAT": "-1"})
        self.assertIn("PULL_TG_ADMINS", " ".join(c.problems()))


class Formatting(unittest.TestCase):
    def test_sizes_and_ages(self):
        self.assertEqual(bot.human_size(500), "500 B")
        self.assertEqual(bot.human_size(660_000), "645 KB")
        self.assertEqual(bot.human_size(154_000_000), "147 MB")
        self.assertEqual(bot.human_size(3_000_000_000), "2.8 GB")
        self.assertEqual(bot.human_age(10), "только что")
        self.assertEqual(bot.human_age(200), "3 мин назад")
        self.assertEqual(bot.human_age(4000), "1 ч 6 мин назад")
        self.assertEqual(bot.human_age(90000), "1 д 1 ч назад")

    def test_summarize_verify_strips_ansi_and_keeps_meaningful_lines(self):
        out = "мусор\n  ✓ база: таблиц 5\n\x1b[33m  ! в архиве на 2 больше\x1b[0m\nещё\n  ✗ упало\n"
        self.assertEqual(bot.summarize_verify(out), ["✓ база: таблиц 5", "! в архиве на 2 больше", "✗ упало"])

    def test_html_escape(self):
        self.assertEqual(bot.esc("<b>&"), "&lt;b&gt;&amp;")


class Listing(unittest.TestCase):
    def test_list_render_roles_and_status(self):
        with tempfile.TemporaryDirectory() as d:
            make_copy(d, "20260924T041701Z", flag="ok")
            make_copy(d, "20260923T041701Z", flag="ok")
            make_copy(d, "20260915T041701Z", flag="bad")
            make_copy(d, "20260815T041701Z")
            # дамп без архива фотографий копией не считается
            open(os.path.join(d, "noova-20260801T041701Z.sql.gz.enc"), "w").close()
            with open(os.path.join(d, ".rotation"), "w") as f:
                f.write("daily=2\nweekly=1\nmonthly=1\n")
            entries = bot.list_backups(d)
            self.assertEqual([e["stamp"][:8] for e in entries], ["20260924", "20260923", "20260915", "20260815"])
            text = bot.render_list(entries, bot.read_rotation(d), datetime(2026, 9, 24, 4, 20, tzinfo=timezone.utc))
        self.assertIn("Копии на хранилище — 4", text)
        self.assertIn("ежедневных: 2, недельных: 1, месячных: 1", text)
        self.assertIn("<b>24.09.2026 04:17 UTC</b> — ежедневная", text)
        self.assertIn("15.09.2026 04:17 UTC</b> — недельная", text)
        self.assertIn("15.08.2026 04:17 UTC</b> — месячная", text)
        self.assertIn("✅ пригодна · 2 мин назад", text)
        self.assertIn("❌ не прошла проверку", text)
        self.assertIn("⏳ не проверена", text)
        self.assertIn("База: <b>645 KB</b> · Фото: <b>147 MB</b>", text)

    def test_empty(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIn("Копий нет", bot.render_list(bot.list_backups(d), None, datetime.now(timezone.utc)))
        self.assertEqual(bot.list_backups("/нет/такого/каталога"), [])


class Disk(unittest.TestCase):
    def test_report_contains_free_used_and_capacity(self):
        with tempfile.TemporaryDirectory() as d:
            make_copy(d, "20260924T041701Z", db=1000, media=1_000_000)
            make_copy(d, "20260923T041701Z", db=1000, media=1_000_000)
            text = bot.disk_report(d, bot.list_backups(d))
        self.assertIn("Backup Noova: Диск", text)
        self.assertIn("Свободно:", text)
        self.assertIn("Занято копиями:", text)
        self.assertIn("(2 шт.)", text)
        self.assertIn("Ещё поместится копий: <b>~", text)

    def test_no_copies_still_reports_free_space(self):
        with tempfile.TemporaryDirectory() as d:
            text = bot.disk_report(d, [])
        self.assertIn("Свободно:", text)
        self.assertNotIn("поместится", text)

    def test_missing_dir_does_not_crash(self):
        self.assertIn("Свободно:", bot.disk_report("/нет/такого", []))


class Handling(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.api = Fake()
        self.bot = bot.Bot(cfg(self.tmp.name), api=self.api)
        self.bot.username = "b"

    def test_stranger_gets_no_reply(self):
        self.assertFalse(self.bot.handle(msg("/list", user=1)))
        self.assertFalse(self.bot.handle(msg("/backup", chat=999)))
        self.assertEqual(self.api.sent, [])

    def test_disk_command(self):
        self.assertTrue(self.bot.handle(msg("/disk")))
        self.assertIn("Свободно", self.api.sent[-1]["text"])
        self.assertTrue(self.bot.handle(msg("/space")))

    def test_help_and_list(self):
        self.assertTrue(self.bot.handle(msg("/help")))
        self.assertTrue(self.bot.handle(msg("/list")))
        self.assertEqual(len(self.api.sent), 2)
        self.assertEqual(self.api.sent[0]["parse_mode"], "HTML")
        self.assertEqual(self.api.sent[0]["reply_to_message_id"], 7)

    def test_unknown_and_other_bot_commands_ignored(self):
        self.assertFalse(self.bot.handle(msg("/rm")))
        self.assertFalse(self.bot.handle(msg("/list@other")))
        self.assertEqual(self.api.sent, [])

    def test_verify_rejects_bad_stamp_and_missing_copy(self):
        self.bot.handle(msg("/verify ../../etc/passwd"))
        self.bot.handle(msg("/verify 20260101T000000Z"))
        self.assertEqual(len(self.api.sent), 2)
        self.assertTrue(all("Ошибка" in m["text"] for m in self.api.sent))

    def test_backup_cooldown_and_busy(self):
        self.bot.running["backup"] = True
        self.bot.handle(msg("/backup"))
        self.assertIn("Уже идёт", self.api.sent[-1]["text"])
        self.bot.running["backup"] = False
        self.bot.last_backup = __import__("time").time()
        self.bot.handle(msg("/backup"))
        self.assertIn("Слишком часто", self.api.sent[-1]["text"])


class Running(unittest.TestCase):
    """Запуск настоящих подпроцессов: подставные pull.sh и storage-verify.sh."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = self.tmp.name
        self.api = Fake()
        self.c = cfg(self.d)
        self.c.lock = os.path.join(self.d, "lock")
        self.b = bot.Bot(self.c, api=self.api)

    def script(self, name, body):
        path = os.path.join(self.d, name)
        with open(path, "w") as f:
            f.write("#!/usr/bin/env bash\n" + body)
        return path

    def test_backup_busy_exit_code_is_reported(self):
        self.c.pull = self.script("pull.sh", "exit 75\n")
        self.b.running["backup"] = True
        self.b._run_backup(7)
        self.assertIn("Занято", self.api.sent[-1]["text"])
        self.assertFalse(self.b.running["backup"])

    def test_backup_passes_nonblocking_lock_env(self):
        marker = os.path.join(self.d, "wait")
        self.c.pull = self.script("pull.sh", f'echo "$PULL_LOCK_WAIT" > {marker}\n')
        self.b._run_backup(7)
        self.assertEqual(open(marker).read().strip(), "0")
        self.assertEqual(self.api.sent, [])  # успех: сообщение шлёт сам pull.sh

    def test_verify_ok_and_bad(self):
        make_copy(self.d, "20260924T041701Z")
        self.c.verify = self.script("v.sh", 'echo "  ✓ база: таблиц 5"; echo "  ✓ фотографии: объектов 9, снимков 3"\n')
        self.b._run_verify("20260924T041701Z", 7)
        self.assertIn("Копия пригодна ✅", self.api.sent[-1]["text"])
        self.assertIn("объектов 9", self.api.sent[-1]["text"])

        self.c.verify = self.script("v2.sh", 'echo "  ✗ Дамп оборван <тест>" >&2; exit 1\n')
        self.b._run_verify("20260924T041701Z", 7)
        self.assertIn("не прошла проверку ❌", self.api.sent[-1]["text"])
        self.assertIn("&lt;тест&gt;", self.api.sent[-1]["text"])
        self.assertTrue(os.path.exists(os.path.join(self.d, "noova-20260924T041701Z.bad")))

    def test_verify_busy_when_lock_held(self):
        make_copy(self.d, "20260924T041701Z")
        self.c.verify = self.script("v.sh", "exit 0\n")
        with bot.FileLock(self.c.lock):
            self.b._run_verify("20260924T041701Z", 7)
        self.assertIn("Занято", self.api.sent[-1]["text"])


if __name__ == "__main__":
    unittest.main()
