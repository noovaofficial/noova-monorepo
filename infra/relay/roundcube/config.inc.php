<?php
// Настройки веб-почты поверх конфигурации образа roundcube/roundcubemail.
// Образ подключает все *.php из /var/roundcube/config после своего конфига,
// поэтому значения здесь главнее. Адреса IMAP/SMTP и ключ сессий — в
// docker-compose.yml и .env.

// Перед Roundcube стоит Caddy (адрес из сети mail в docker-compose.yml). Без
// доверия к его X-Forwarded-For в журнале входов вместо адреса посетителя
// стоял бы адрес Caddy, и по журналу нельзя было бы понять, кто подбирает.
$config['proxy_whitelist'] = ['10.77.0.10'];
$config['use_https'] = true;

// Три неудачных входа в минуту — и ящик закрыт на минуту. Считается по ящику,
// а не по адресу посетителя, и только для ящиков, которые уже входили в
// веб-почту: счётчик хранится в их записи в базе Roundcube. Массовый подбор
// останавливает Stalwart: для него все входы через веб-почту идут с адреса
// Roundcube, и после сотни ошибок за сутки он банит этот адрес — веб-почта
// перестаёт пускать всех на сутки (smtp.md, «Разбан»).
$config['login_rate_limit'] = 3;
$config['log_logins'] = true;

// Вход только полным адресом: доменов два, и «support» без домена неоднозначен.
$config['login_username_filter'] = 'email';
$config['session_lifetime'] = 60;

// Сертификат Stalwart проверяется всегда: пароль уходит в эти соединения.
$config['imap_conn_options'] = ['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]];
$config['smtp_conn_options'] = ['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]];

$config['product_name'] = 'Noova Mail';
