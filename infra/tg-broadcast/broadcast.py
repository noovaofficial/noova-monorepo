#!/usr/bin/env python3
"""
Разовая рассылка моделям от Telegram-аккаунта компании (не бота: бот не может
написать первым тому, кто его не запускал). Получатели — контакты, которые
модели сами прислали на почтовый ящик компании.

Это автоматизация ОБЫЧНОГО аккаунта (MTProto, Telethon), и Telegram режет её
жёстко: сообщения людям без переписки и не из контактов быстро дают
PeerFlood — ограничение аккаунта, а при жалобах получателей и бан. Поэтому:

  * по умолчанию — пробный прогон, ничего не отправляется (нужен --send);
  * медленно: пауза 60–150 с между сообщениями, не больше --daily-cap в сутки;
  * на PeerFlood — немедленная остановка, без повторов;
  * каждое действие пишется в sent.jsonl, повторный запуск продолжает с
    необработанных и считает дневной лимит по этому же журналу.

recipients.csv — колонки name, telegram, locale. telegram — «@ник», «ник»,
«t.me/ник» или телефон в E.164 (телефон сначала импортируется в контакты
аккаунта — иначе по номеру не написать); locale — de/en/ru..., может быть пустым.

Текст — messages/<locale>.txt, при отсутствии — messages/en.txt. {name} в
тексте заменяется на имя из CSV; строки без имени при таком тексте пропускаются.
Разметка — HTML Telegram: <b>жирный</b>, <i>курсив</i>, <code>копируется
по нажатию</code>, <a href="https://…">ссылка</a>; символы < > & в самом
тексте писать как &lt; &gt; &amp;.

Несколько аккаунтов. Если рядом лежит accounts.json (см.
accounts.example.json), каждое следующее сообщение уходит с другого аккаунта:
берётся тот, с которого сегодня отправлено меньше всего, при равенстве — по
кругу. На 20 сообщений и 7 аккаунтов выходит по 2–3 с каждого. --daily-cap
считается на КАЖДЫЙ аккаунт. Аккаунт, получивший PeerFlood или длинный
FloodWait, выбывает до конца запуска, а его сообщение уходит с другого;
когда выбыли все — остановка. Без accounts.json работает один прежний
аккаунт (сессия noova-company.session).

Это распределяет нагрузку между вашими официальными аккаунтами, но не делает
рассылку незнакомым людям безопасной: Telegram смотрит на жалобы и на текст,
а не только на счётчик. Пишем только тем, кто сам прислал контакт, подписываем
аккаунты как официальные (имя, аватар, описание) и не повышаем темп.

Вход: TG_API_ID и TG_API_HASH с my.telegram.org (раздел API development tools)
— в окружении или в .env рядом со скриптом; для аккаунта в accounts.json можно
задать свои api_id/api_hash. Сессии аккаунтов лежат в sessions/<имя>.session;
войти во все разом: `broadcast.py --login` (спросит телефон и код для каждого,
у кого сессии ещё нет). Эти файлы дают полный доступ к аккаунтам — хранить как
пароли и не коммитить.

  make tg-broadcast-test   # первые трое, для проверки глазами
  make tg-broadcast        # все, до дневного лимита; повторять раз в сутки
  python3 broadcast.py recipients.csv   # пробный прогон, ничего не отправляет
"""

import argparse
import asyncio
import csv
import html
import json
import os
import random
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOG_PATH = HERE / 'sent.jsonl'
MESSAGES_DIR = HERE / 'messages'
SESSIONS_DIR = HERE / 'sessions'
ACCOUNTS_PATH = HERE / 'accounts.json'
# Прежняя единственная сессия: работает, пока нет accounts.json, и её старые
# записи в журнале (без поля account) относятся к ней.
LEGACY_ACCOUNT = 'noova-company'
ENV_PATH = HERE / '.env'
NAME_PLACEHOLDER = '{name}'

# Статусы, после которых получателя больше не трогаем. error — можно
# повторить, удалив его строку из журнала.
FINAL = {'sent', 'not_found', 'privacy', 'deactivated'}

# FloodWait дольше этого — не ждём, а останавливаемся: это уже сигнал, что
# темп для Telegram слишком высокий.
MAX_FLOOD_WAIT_S = 15 * 60


def normalize(raw):
    """«@Nick», «nick», «https://t.me/nick», «+49 170 123» -> «nick» / «+49170123»."""
    v = raw.strip()
    v = re.sub(r'^(https?://)?(t\.me|telegram\.me)/', '', v, flags=re.I)
    if re.fullmatch(r'\+?[\d\s\-()]{7,}', v):
        return '+' + re.sub(r'\D', '', v)
    return v.lstrip('@').lower()


def load_env():
    """KEY=value из .env рядом со скриптом; уже заданное в окружении не перетирает."""
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip().removeprefix('export ').strip(), v.strip().strip('"\''))


def load_recipients(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        missing = {'name', 'telegram'} - set(reader.fieldnames or [])
        if missing:
            sys.exit(f'В {path} нет колонок {sorted(missing)} (есть: {reader.fieldnames}). Нужно: name,telegram,locale')
        rows = list(reader)
    seen, out = set(), []
    for r in rows:
        key = normalize(r.get('telegram') or '')
        if key and key not in seen:
            seen.add(key)
            out.append({
                'key': key,
                'name': (r.get('name') or '').strip(),
                'locale': (r.get('locale') or 'en').strip().lower() or 'en',
            })
    return out


def load_log():
    if not LOG_PATH.exists():
        return []
    return [json.loads(line) for line in LOG_PATH.read_text(encoding='utf-8').splitlines() if line.strip()]


def append_log(entry):
    entry = {**entry, 'at': datetime.now(timezone.utc).isoformat()}
    with LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')


_messages = {}


def message_for(locale):
    if locale not in _messages:
        path = MESSAGES_DIR / f'{locale}.txt'
        if not path.exists():
            path = MESSAGES_DIR / 'en.txt'
        _messages[locale] = path.read_text(encoding='utf-8').strip()
    return _messages[locale]


def render(r):
    # Имя экранируем: текст уходит как HTML, и «<» или «&» в имени сломали бы разметку.
    return message_for(r['locale']).replace(NAME_PLACEHOLDER, html.escape(r['name']))


def needs_name(r):
    return NAME_PLACEHOLDER in message_for(r['locale']) and not r['name']


def load_accounts(path):
    """accounts.json -> [{name, session, api_id, api_hash}]; без файла — прежний один аккаунт."""
    if not path.exists():
        return [{'name': LEGACY_ACCOUNT, 'session': str(HERE / LEGACY_ACCOUNT),
                 'api_id': os.environ.get('TG_API_ID'), 'api_hash': os.environ.get('TG_API_HASH')}]
    raw = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(raw, list) or not raw:
        sys.exit(f'{path}: ожидается непустой список аккаунтов [{{"name": "support1"}}, …]')
    out, seen = [], set()
    for item in raw:
        name = (item.get('name') or '').strip() if isinstance(item, dict) else ''
        if not re.fullmatch(r'[\w.-]+', name):
            sys.exit(f'{path}: у аккаунта нужно имя из букв, цифр, «_», «-», «.» (получено: {item!r})')
        if name in seen:
            sys.exit(f'{path}: имя аккаунта «{name}» повторяется')
        seen.add(name)
        out.append({
            'name': name,
            'session': str(SESSIONS_DIR / name),
            'api_id': item.get('api_id') or os.environ.get('TG_API_ID'),
            'api_hash': item.get('api_hash') or os.environ.get('TG_API_HASH'),
        })
    return out


def pick_account(names, sent, cap, blocked, last):
    """Следующий аккаунт: меньше всего отправлено сегодня; при равенстве — по кругу после `last`.

    Выбывшие (`blocked`) и достигшие дневного лимита не берутся. None — брать некого.
    """
    available = [n for n in names if n not in blocked and sent.get(n, 0) < cap]
    if not available:
        return None
    start = names.index(last) + 1 if last in names else 0
    order = names[start:] + names[:start]
    return min((n for n in order if n in available), key=lambda n: sent.get(n, 0))


def sent_today_by_account(log, today):
    sent = {}
    for e in log:
        if e['status'] == 'sent' and e['at'].startswith(today):
            name = e.get('account', LEGACY_ACCOUNT)
            sent[name] = sent.get(name, 0) + 1
    return sent


async def resolve(client, key):
    from telethon.tl.functions.contacts import ImportContactsRequest
    from telethon.tl.types import InputPhoneContact

    if key.startswith('+'):
        res = await client(ImportContactsRequest([
            InputPhoneContact(client_id=random.randrange(2**62), phone=key, first_name=key, last_name='')
        ]))
        return res.users[0] if res.users else None  # номера нет в Telegram или он скрыт
    return await client.get_entity(key)


async def open_clients(accounts, stack):
    """Подключает все аккаунты; без сессии Telethon спросит телефон и код."""
    from telethon import TelegramClient

    clients = {}
    for acc in accounts:
        if not acc['api_id'] or not acc['api_hash']:
            sys.exit(f'Для аккаунта {acc["name"]} нужны TG_API_ID и TG_API_HASH (my.telegram.org).')
        SESSIONS_DIR.mkdir(exist_ok=True)
        client = TelegramClient(acc['session'], int(acc['api_id']), acc['api_hash'])
        await client.start()
        stack.push_async_callback(client.disconnect)
        me = await client.get_me()
        print(f'Аккаунт {acc["name"]}: {me.first_name} @{me.username or "—"}')
        clients[acc['name']] = client
    print()
    return clients


async def login_all(accounts):
    from contextlib import AsyncExitStack

    async with AsyncExitStack() as stack:
        await open_clients(accounts, stack)
    print('Готово: сессии сохранены.')


async def send_all(args, pending, sent_by, accounts):
    # Telethon нужен только для реальной отправки — пробный прогон работает без него.
    from contextlib import AsyncExitStack
    from telethon import errors

    names = [a['name'] for a in accounts]
    queue = list(pending)
    blocked, last = set(), None

    async with AsyncExitStack() as stack:
        clients = await open_clients(accounts, stack)

        while queue:
            name = pick_account(names, sent_by, args.daily_cap, blocked, last)
            if name is None:
                if blocked:
                    print(f'\nАккаунты выбыли ({", ".join(sorted(blocked))}) или исчерпали лимит. Остановлено.')
                else:
                    print(f'\nДневной лимит {args.daily_cap} на аккаунт исчерпан у всех. Продолжить завтра тем же запуском.')
                return
            client, r = clients[name], queue.pop(0)
            key = r['key']
            last = name
            sent_ok = False

            try:
                entity = await resolve(client, key)
                if entity is None:
                    append_log({'key': key, 'status': 'not_found', 'account': name})
                    print(f'  {key}: не найден')
                    continue
                await client.send_message(entity, render(r), parse_mode='html')
                append_log({'key': key, 'status': 'sent', 'account': name})
                sent_by[name] = sent_by.get(name, 0) + 1
                sent_ok = True
                print(f'  {key}: отправлено с {name} ({sent_by[name]}/{args.daily_cap})')
            except errors.PeerFloodError:
                # Ограничен этот аккаунт, а не получатель: получателя отдаём другому.
                append_log({'key': key, 'status': 'error', 'error': 'PeerFlood', 'account': name})
                blocked.add(name)
                queue.insert(0, r)
                print(f'\n  {name}: PeerFlood — Telegram ограничил аккаунт. Он выбывает до конца запуска;')
                print('  не использовать его минимум сутки, статус — у @SpamBot.')
                continue
            except errors.FloodWaitError as e:
                append_log({'key': key, 'status': 'error', 'error': f'FloodWait {e.seconds}s', 'account': name})
                blocked.add(name)
                queue.insert(0, r)
                note = ' — слишком долго' if e.seconds > MAX_FLOOD_WAIT_S else ''
                print(f'  {name}: FloodWait {e.seconds} с{note}, аккаунт выбывает до конца запуска')
                continue
            except (errors.UsernameNotOccupiedError, errors.UsernameInvalidError, ValueError):
                append_log({'key': key, 'status': 'not_found', 'account': name})
                print(f'  {key}: ник не существует')
                continue
            except (errors.UserPrivacyRestrictedError, errors.UserIsBlockedError, errors.ChatWriteForbiddenError):
                append_log({'key': key, 'status': 'privacy', 'account': name})
                print(f'  {key}: закрыт настройками приватности')
                continue
            except errors.InputUserDeactivatedError:
                append_log({'key': key, 'status': 'deactivated', 'account': name})
                print(f'  {key}: аккаунт удалён')
                continue
            except errors.RPCError as e:
                append_log({'key': key, 'status': 'error', 'error': repr(e), 'account': name})
                print(f'  {key}: ошибка {e!r}')
                continue
            finally:
                # Пауза — только после реальной отправки: на не найденных и
                # закрытых ничего не ушло, ждать незачем.
                if sent_ok and queue:
                    await asyncio.sleep(random.uniform(args.delay_min, args.delay_max))

    print('\nГотово. Журнал — sent.jsonl.')


def main():
    p = argparse.ArgumentParser(description='Разовая рассылка моделям от аккаунта компании')
    p.add_argument('recipients', nargs='?', help='CSV с колонкой telegram (и необязательной locale)')
    p.add_argument('--login', action='store_true', help='войти во все аккаунты из accounts.json и сохранить сессии')
    p.add_argument('--accounts', default=str(ACCOUNTS_PATH), help='JSON со списком аккаунтов (по умолчанию accounts.json)')
    p.add_argument('--send', action='store_true', help='реально отправлять (без флага — пробный прогон)')
    p.add_argument('--limit', type=int, help='обработать не больше N получателей за запуск')
    p.add_argument('--daily-cap', type=int, default=25, help='не больше N отправленных в сутки С КАЖДОГО аккаунта (по умолчанию 25)')
    p.add_argument('--delay-min', type=float, default=60, help='минимальная пауза между сообщениями, с')
    p.add_argument('--delay-max', type=float, default=150, help='максимальная пауза между сообщениями, с')
    args = p.parse_args()
    load_env()
    accounts = load_accounts(Path(args.accounts))
    names = [a['name'] for a in accounts]

    if args.login:
        asyncio.run(login_all(accounts))
        return
    if not args.recipients:
        sys.exit('Укажите CSV с получателями (или --login).')

    if not (MESSAGES_DIR / 'en.txt').exists():
        sys.exit(f'Нет {MESSAGES_DIR / "en.txt"} — текст по умолчанию обязателен.')

    recipients = load_recipients(args.recipients)
    log = load_log()
    done = {e['key'] for e in log if e['status'] in FINAL}
    today = date.today().isoformat()
    sent_by = sent_today_by_account(log, today)

    pending = [r for r in recipients if r['key'] not in done]
    # Без имени текст с {name} выйдет с дырой («Hi , …») — таких не шлём, а
    # показываем: имя можно дописать в CSV и запустить снова.
    nameless = [r for r in pending if needs_name(r)]
    pending = [r for r in pending if not needs_name(r)]
    if args.limit:
        pending = pending[: args.limit]

    locales = {}
    for r in pending:
        locales[r['locale']] = locales.get(r['locale'], 0) + 1
    print(f'Получателей в CSV: {len(recipients)}, уже обработано: {len(done)}, в этом прогоне: {len(pending)}')
    print(f'По языкам: {locales}')
    print(f'Аккаунтов: {len(accounts)} ({", ".join(names)}); отправлено сегодня: '
          + ', '.join(f'{n} {sent_by.get(n, 0)}/{args.daily_cap}' for n in names))
    if nameless:
        print(f'Пропущены — нет имени, а в тексте есть {NAME_PLACEHOLDER}: {", ".join(r["key"] for r in nameless)}')

    if not args.send:
        for locale in sorted(locales):
            sample = next(r for r in pending if r['locale'] == locale)
            print(f'\n--- {locale} (как увидит {sample["name"] or sample["key"]}) ---\n{render(sample)}')
        # Раскладка по аккаунтам — ровно та, что получится при отправке.
        plan, counts, last = [], dict(sent_by), None
        for r in pending:
            name = pick_account(names, counts, args.daily_cap, set(), last)
            if name is None:
                break
            counts[name] = counts.get(name, 0) + 1
            last = name
            plan.append((r['key'], name))
        print('\nКто с какого аккаунта получит:', ', '.join(f'{k} ← {n}' for k, n in plan[:10]))
        if plan:
            per = {}
            for _, n in plan:
                per[n] = per.get(n, 0) + 1
            print('Сообщений на аккаунт:', ', '.join(f'{n}: {c}' for n, c in per.items()))
        if len(plan) < len(pending):
            print(f'Лимит {args.daily_cap} на аккаунт покроет {len(plan)} из {len(pending)}, остальные — в следующие дни.')
        print('\nПробный прогон: ничего не отправлено. Для отправки добавьте --send.')
        return

    if 'TODO' in message_for('en'):
        sys.exit('В messages/en.txt ещё заготовка — сначала впишите текст.')

    asyncio.run(send_all(args, pending, sent_by, accounts))


if __name__ == '__main__':
    main()
