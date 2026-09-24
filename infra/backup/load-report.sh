#!/usr/bin/env bash
#
# Суточный отчёт о нагрузке по журналу load-sample.sh. Печатает сообщение
# для Telegram (HTML) в stdout. Вызывается из watch.sh.
#
#   bash load-report.sh [журнал] [сейчас-epoch]
#
# Код 3 — данных мало (меньше трёх замеров за сутки): отчёт не строим, чтобы не
# показывать среднее по одному замеру.
#
# «Нагрузка CPU» здесь — load average за минуту, делённый на число ядер.
# Это не процент процессора, а длина очереди на ядро: 100% — все ядра заняты
# и никто не ждёт, выше — процессы стоят в очереди. Для сравнения периодов
# этого достаточно, точных секунд процессора он не даёт.
set -euo pipefail

LOG="${1:-${NOOVA_BACKUP_STATE:-$HOME/.noova-backup}/load.log}"
NOW="${2:-$(date +%s)}"
HOST="$(hostname)"

[ -f "$LOG" ] || exit 3

awk -F'|' -v now="$NOW" -v host="$HOST" '
function hhmm(e,   cmd, out) {
	cmd = "date -u -d @" e " +%H:%M"
	cmd | getline out
	close(cmd)
	return out
}
function size(gb) { return gb >= 1 ? sprintf("%d GB", gb) : "<1 GB" }
$1 >= now - 86400 && NF >= 8 {
	n++
	cpu = $3 / $2 * 100
	cpu_sum += cpu
	if (cpu > cpu_max) { cpu_max = cpu; cpu_at = $1 }
	mem_sum += $4
	if ($4 > mem_max) mem_max = $4
	cores = $2; mem_total = $5
	disk_pct = $6; disk_used = $7; disk_total = $8
	if (!first_disk) first_disk = $6
	m = split($9, parts, ",")
	for (i = 1; i <= m; i++) {
		split(parts[i], kv, "=")
		if (kv[1] == "") continue
		if (kv[2] + 0 > peak[kv[1]]) peak[kv[1]] = kv[2] + 0
		names[kv[1]] = 1
	}
}
END {
	if (n < 3) exit 3
	status = "🟢"
	if (cpu_max >= 80 || mem_max >= 90 || disk_pct >= 85) status = "🔴"
	else if (cpu_max >= 50 || mem_max >= 75 || disk_pct >= 70) status = "🟡"
	printf "<b>Server Noova (%s): Нагрузка за 24 ч %s</b>\n", host, status
	printf "Нагрузка CPU (ядер: %d): среднее <b>%d%%</b>, пик <b>%d%%</b> в %s UTC\n", cores, cpu_sum / n, cpu_max, hhmm(cpu_at)
	printf "Память (%s MB): среднее <b>%d%%</b>, пик <b>%d%%</b>\n", mem_total, mem_sum / n, mem_max
	printf "Диск: <b>%d%%</b> (%s из %s)", disk_pct, size(disk_used), size(disk_total)
	if (disk_pct != first_disk) printf ", за сутки %+d п.п.", disk_pct - first_disk
	printf "\n"
	# Контейнеры по убыванию пика CPU, только заметные (>=0.5%), не больше пяти.
	c = 0
	for (name in names) if (peak[name] >= 0.5) { c++; list[c] = name }
	for (i = 1; i <= c; i++) for (j = i + 1; j <= c; j++) if (peak[list[j]] > peak[list[i]]) { t = list[i]; list[i] = list[j]; list[j] = t }
	if (c > 0) {
		printf "Контейнеры, пик CPU:"
		for (i = 1; i <= c && i <= 5; i++) printf " %s <b>%.1f%%</b>%s", list[i], peak[list[i]], (i < c && i < 5) ? " ·" : ""
		printf "\n"
	} else printf "Контейнеры: заметной нагрузки не было\n"
	printf "Замеров: %d (каждые 10 минут)", n
}
' "$LOG"
