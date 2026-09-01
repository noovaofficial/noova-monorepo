# Развёртывание

| Документ | О чём |
|---|---|
| [vps.md](vps.md) | подготовка машин: Prod, SMTP, Backup |
| [prod.md](prod.md) | `.env` и выпуск прода |
| [smtp.md](smtp.md) | почтовый релей |
| [backup.md](backup.md) | резервные копии |
| [migration.md](migration.md) | переезд на другой домен или сервер |

---

## Первое развёртывание

| | Шаг | Где |
|---|---|---|
| 1 | Заявка провайдеру: исходящий 25-й, PTR | [vps.md](vps.md) |
| 2 | Проверить IP на `check.spamhaus.org` | [vps.md](vps.md) |
| 3 | `A`-записи домена | [vps.md](vps.md) |
| 4 | `ssh-copy-id`, `make server-setup` | [vps.md](vps.md) |
| 5 | `make server-env` | [prod.md](prod.md) |
| 6 | `make deploy` | [prod.md](prod.md) |
| 7 | DKIM в DNS | [smtp.md](smtp.md) |
| 7а | Если 25-й закрыт — релей | [smtp.md](smtp.md) |
| 8 | Справочники | [prod.md](prod.md) |
| 9 | Первый администратор | [prod.md](prod.md) |
| 10 | Проверить, что письмо не в спаме | [smtp.md](smtp.md) |
| 11 | Резервные копии | [backup.md](backup.md) |

Шаг 1 первый по времени отклика, не по важности: тикет идёт часы или сутки.
Шаг 11 — до того, как придут люди.

## Проверка после выпуска

```bash
docker compose ps                      # все healthy
curl -I https://<домен>                # 200, валидный TLS
docker compose logs -f api             # ошибок нет
```
