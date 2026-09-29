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

Вход: TG_API_ID и TG_API_HASH с my.telegram.org (раздел API development tools)
для аккаунта компании — в окружении или в .env рядом со скриптом. Первый
запуск с --send спросит телефон и код из Telegram и сохранит сессию в
noova-company.session: дальше вход не нужен. Этот файл даёт полный доступ к
аккаунту — хранить как пароль и не коммитить.

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
SESSION = str(HERE / 'noova-company')
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


async def resolve(client, key):
    from telethon.tl.functions.contacts import ImportContactsRequest
    from telethon.tl.types import InputPhoneContact

    if key.startswith('+'):
        res = await client(ImportContactsRequest([
            InputPhoneContact(client_id=random.randrange(2**62), phone=key, first_name=key, last_name='')
        ]))
        return res.users[0] if res.users else None  # номера нет в Telegram или он скрыт
    return await client.get_entity(key)


async def send_all(args, pending, sent_today):
    # Telethon нужен только для реальной отправки — пробный прогон работает без него.
    from telethon import TelegramClient, errors

    api_id, api_hash = os.environ.get('TG_API_ID'), os.environ.get('TG_API_HASH')
    if not api_id or not api_hash:
        sys.exit('Нужны TG_API_ID и TG_API_HASH (my.telegram.org).')

    async with TelegramClient(SESSION, int(api_id), api_hash) as client:
        me = await client.get_me()
        print(f'Аккаунт: {me.first_name} @{me.username or "—"}\n')

        for i, r in enumerate(pending):
            if sent_today >= args.daily_cap:
                print(f'Дневной лимит {args.daily_cap} исчерпан. Продолжить завтра тем же запуском.')
                return

            key = r['key']
            try:
                entity = await resolve(client, key)
                if entity is None:
                    append_log({'key': key, 'status': 'not_found'})
                    print(f'  {key}: не найден')
                    continue
                await client.send_message(entity, render(r), parse_mode='html')
                append_log({'key': key, 'status': 'sent'})
                sent_today += 1
                print(f'  {key}: отправлено ({sent_today}/{args.daily_cap})')
            except errors.PeerFloodError:
                append_log({'key': key, 'status': 'error', 'error': 'PeerFlood'})
                print('\nPeerFlood: Telegram ограничил аккаунт за рассылку. Остановлено.')
                print('Не запускать снова минимум сутки; статус ограничения — у @SpamBot.')
                return
            except errors.FloodWaitError as e:
                append_log({'key': key, 'status': 'error', 'error': f'FloodWait {e.seconds}s'})
                if e.seconds > MAX_FLOOD_WAIT_S:
                    print(f'\nFloodWait {e.seconds} с — слишком долго, остановлено.')
                    return
                print(f'  FloodWait {e.seconds} с, ждём…')
                await asyncio.sleep(e.seconds + 5)
                continue
            except (errors.UsernameNotOccupiedError, errors.UsernameInvalidError, ValueError):
                append_log({'key': key, 'status': 'not_found'})
                print(f'  {key}: ник не существует')
                continue
            except (errors.UserPrivacyRestrictedError, errors.UserIsBlockedError, errors.ChatWriteForbiddenError):
                append_log({'key': key, 'status': 'privacy'})
                print(f'  {key}: закрыт настройками приватности')
                continue
            except errors.InputUserDeactivatedError:
                append_log({'key': key, 'status': 'deactivated'})
                print(f'  {key}: аккаунт удалён')
                continue
            except errors.RPCError as e:
                append_log({'key': key, 'status': 'error', 'error': repr(e)})
                print(f'  {key}: ошибка {e!r}')
                continue

            if i < len(pending) - 1:
                await asyncio.sleep(random.uniform(args.delay_min, args.delay_max))

    print('\nГотово. Журнал — sent.jsonl.')


def main():
    p = argparse.ArgumentParser(description='Разовая рассылка моделям от аккаунта компании')
    p.add_argument('recipients', help='CSV с колонкой telegram (и необязательной locale)')
    p.add_argument('--send', action='store_true', help='реально отправлять (без флага — пробный прогон)')
    p.add_argument('--limit', type=int, help='обработать не больше N получателей за запуск')
    p.add_argument('--daily-cap', type=int, default=25, help='не больше N отправленных в сутки (по умолчанию 25)')
    p.add_argument('--delay-min', type=float, default=60, help='минимальная пауза между сообщениями, с')
    p.add_argument('--delay-max', type=float, default=150, help='максимальная пауза между сообщениями, с')
    args = p.parse_args()
    load_env()

    if not (MESSAGES_DIR / 'en.txt').exists():
        sys.exit(f'Нет {MESSAGES_DIR / "en.txt"} — текст по умолчанию обязателен.')

    recipients = load_recipients(args.recipients)
    log = load_log()
    done = {e['key'] for e in log if e['status'] in FINAL}
    today = date.today().isoformat()
    sent_today = sum(1 for e in log if e['status'] == 'sent' and e['at'].startswith(today))

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
    print(f'Отправлено сегодня: {sent_today}/{args.daily_cap}')
    if nameless:
        print(f'Пропущены — нет имени, а в тексте есть {NAME_PLACEHOLDER}: {", ".join(r["key"] for r in nameless)}')

    if not args.send:
        for locale in sorted(locales):
            sample = next(r for r in pending if r['locale'] == locale)
            print(f'\n--- {locale} (как увидит {sample["name"] or sample["key"]}) ---\n{render(sample)}')
        print('\nПервые получатели:', ', '.join(r['key'] for r in pending[:10]))
        print('\nПробный прогон: ничего не отправлено. Для отправки добавьте --send.')
        return

    if 'TODO' in message_for('en'):
        sys.exit('В messages/en.txt ещё заготовка — сначала впишите текст.')

    asyncio.run(send_all(args, pending, sent_today))


if __name__ == '__main__':
    main()
