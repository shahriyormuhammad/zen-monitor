#!/usr/bin/env bash
# One-shot installer for production infra fixes on metric-pulse-app-01.
# Run this on the server from /srv/projects/enterprise-wb-analytics:
#   bash ops/install-on-production.sh
#
# Applies:
#   * /etc/nginx/sites-available/enterprise-wb-analytics (production reverse proxy)
#   * /etc/systemd/system/enterprise-wb-analytics.service (Next standalone prestart guard)
#   * /etc/systemd/system/enterprise-wb-analytics-*-worker.service (domain worker apps)
#   * /etc/systemd/system/enterprise-wb-analytics-*-inngest.service (domain Inngest runtimes)
#   * enterprise-wb-network-hardening.service + /usr/local/sbin firewall script
#   * /etc/logrotate.d/enterprise-wb-analytics (+ force-rotate the 860M inngest log)
#   * systemd service+timer for nightly-db-backup (runs scripts/nightly-db-backup.mjs daily 03:30)
#   * systemd service+timer for ops-watchdog (runs scripts/ops-watchdog.mjs every 5 min)
#   * move stale .env.{production,runtime}.bak* into /srv/backups/enterprise-wb-analytics/env/
#   * journalctl vacuum 3.9G -> 500M
#
# Idempotent: safe to re-run.

set -euo pipefail

REPO=/srv/projects/enterprise-wb-analytics
RUNTIME_ENV="$REPO/.env.runtime"
cd "$REPO"

read_env_value() {
  local key="$1"
  node -e '
const fs = require("node:fs");
const [key, filePath] = process.argv.slice(1);
if (!fs.existsSync(filePath)) process.exit(0);
const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
for (const rawLine of lines) {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separatorIndex = rawLine.indexOf("=");
  if (separatorIndex === -1) continue;
  const currentKey = rawLine.slice(0, separatorIndex).trim();
  if (currentKey !== key) continue;
  let value = rawLine.slice(separatorIndex + 1).trim();
  const quoted =
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"));
  if (quoted) value = value.slice(1, -1);
  process.stdout.write(value);
  break;
}
' "$key" "$RUNTIME_ENV"
}

has_env_value() {
  [[ -n "$(read_env_value "$1")" ]]
}

echo "[1/7] Installing logrotate config"
install -m 0644 ops/logrotate/enterprise-wb-analytics /etc/logrotate.d/enterprise-wb-analytics
install -m 0644 ops/nginx/enterprise-wb-analytics /etc/nginx/sites-available/enterprise-wb-analytics
ln -sfn /etc/nginx/sites-available/enterprise-wb-analytics /etc/nginx/sites-enabled/enterprise-wb-analytics
nginx -t
systemctl reload nginx

echo "[2/7] Force rotate now to truncate the 860M inngest log"
logrotate_stamp="$(date +%Y%m%d)"
if compgen -G "/var/log/enterprise-wb-analytics*.log-${logrotate_stamp}*" >/dev/null; then
  echo "logrotate already ran for ${logrotate_stamp}; skipping force-rotate to keep reruns idempotent"
else
  logrotate -f /etc/logrotate.d/enterprise-wb-analytics
fi
if compgen -G "/var/log/enterprise-wb-analytics*.log" >/dev/null; then
  ls -lh /var/log/enterprise-wb-analytics*.log
else
  echo "log files are not present yet; skipping ls"
fi

echo "[3/7] Installing systemd units"
chmod 0755 "$REPO/ops/prepare-next-standalone.sh"
install -m 0755 ops/network/enterprise-wb-network-hardening.sh /usr/local/sbin/enterprise-wb-network-hardening.sh
install -m 0644 ops/systemd/enterprise-wb-analytics.service           /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-sync-worker.service /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-inngest.service   /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-redistribution-worker.service /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-advertising-worker.service /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-reviews-worker.service /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-ops-worker.service /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-backup.service   /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-backup.timer     /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-watchdog.service /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-analytics-watchdog.timer   /etc/systemd/system/
install -m 0644 ops/systemd/enterprise-wb-network-hardening.service  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now enterprise-wb-network-hardening.service
systemctl disable --now \
  enterprise-wb-analytics-redistribution-inngest.service \
  enterprise-wb-analytics-advertising-inngest.service \
  enterprise-wb-analytics-reviews-inngest.service || true
systemctl enable --now \
  enterprise-wb-analytics-sync-worker.service \
  enterprise-wb-analytics-redistribution-worker.service \
  enterprise-wb-analytics-advertising-worker.service \
  enterprise-wb-analytics-reviews-worker.service \
  enterprise-wb-analytics-ops-worker.service \
  enterprise-wb-analytics-inngest.service

echo "[4/7] Enabling + starting timers"
backup_database_url="$(read_env_value DATABASE_URL)"
backup_source_database_url="$(read_env_value BACKUP_DATABASE_URL)"
backup_restore_database_url="$(read_env_value BACKUP_RESTORE_DATABASE_URL)"
backup_retention_days="$(read_env_value BACKUP_RETENTION_DAYS)"
backup_restore_min_tables="$(read_env_value BACKUP_RESTORE_MIN_TABLES)"
backup_timer_ready=false

if [[ -z "$backup_source_database_url" ]]; then
  backup_source_database_url="postgresql:///enterprise_wb_analytics_prod"
fi
if [[ -z "$backup_retention_days" ]]; then
  backup_retention_days="7"
fi
if [[ -z "$backup_restore_min_tables" ]]; then
  backup_restore_min_tables="10"
fi

if [[ -n "$backup_database_url" && -n "$backup_restore_database_url" ]]; then
  if node -e '
const [runtimeSource, backupSource, restore] = process.argv.slice(1);
function normalize(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}
const restoreTarget = normalize(restore);
process.exit(
  normalize(runtimeSource) === restoreTarget || normalize(backupSource) === restoreTarget
    ? 1
    : 0
);
' "$backup_database_url" "$backup_source_database_url" "$backup_restore_database_url"; then
    backup_timer_ready=true
  else
    echo "WARN: BACKUP_RESTORE_DATABASE_URL совпадает с source DB; backup.timer оставлен выключенным"
  fi
else
  echo "WARN: BACKUP_RESTORE_DATABASE_URL не задан; backup.timer оставлен выключенным до настройки отдельной restore DB"
fi

if [[ "$backup_timer_ready" == true ]]; then
  install -d -m 750 -o postgres -g postgres /srv/backups/enterprise-wb-analytics/nightly
  chgrp postgres /srv/backups/enterprise-wb-analytics
  chmod 710 /srv/backups/enterprise-wb-analytics
  umask 077
  {
    echo "DATABASE_URL=${backup_source_database_url}"
    echo "BACKUP_RESTORE_DATABASE_URL=${backup_restore_database_url}"
    echo "BACKUP_DIR=/srv/backups/enterprise-wb-analytics/nightly"
    echo "BACKUP_RETENTION_DAYS=${backup_retention_days}"
    echo "BACKUP_RESTORE_MIN_TABLES=${backup_restore_min_tables}"
  } > "$REPO/.env.backup"
  chown root:root "$REPO/.env.backup"
  chmod 600 "$REPO/.env.backup"
  systemctl enable --now enterprise-wb-analytics-backup.timer
else
  systemctl disable --now enterprise-wb-analytics-backup.timer >/dev/null 2>&1 || true
  systemctl reset-failed enterprise-wb-analytics-backup.service >/dev/null 2>&1 || true
fi

systemctl enable --now enterprise-wb-analytics-watchdog.timer

watchdog_missing_env=()
has_env_value TELEGRAM_BOT_TOKEN || watchdog_missing_env+=("TELEGRAM_BOT_TOKEN")
has_env_value TELEGRAM_OPS_CHAT_ID || watchdog_missing_env+=("TELEGRAM_OPS_CHAT_ID")
if [[ ${#watchdog_missing_env[@]} -gt 0 ]]; then
  echo "WARN: watchdog будет работать в log-only режиме, потому что отсутствуют: ${watchdog_missing_env[*]}"
else
  echo "watchdog Telegram delivery: enabled"
fi

systemctl list-timers --no-pager | grep -E 'enterprise-wb-analytics|NEXT' | head -10

echo "[5/7] Moving stale .env.*.bak* to /srv/backups/enterprise-wb-analytics/env/"
mkdir -p /srv/backups/enterprise-wb-analytics/env
chmod 700 /srv/backups/enterprise-wb-analytics/env
mv -v "$REPO"/.env.production.bak.* /srv/backups/enterprise-wb-analytics/env/ 2>/dev/null || true
mv -v "$REPO"/.env.runtime.bak*     /srv/backups/enterprise-wb-analytics/env/ 2>/dev/null || true
ls -la "$REPO"/.env* | head -10

echo "[6/7] Vacuuming journalctl to 500M"
journalctl --vacuum-size=500M
journalctl --disk-usage

echo "[7/7] Disk usage after cleanup"
df -h /

echo
echo "=== Verify (ожидаемо) ==="
echo "enterprise-wb-analytics-backup.timer   NEXT ~ 03:30 MSK"
echo "enterprise-wb-analytics-watchdog.timer NEXT ~ 5 minutes"
echo "inngest.log size должен быть < 100 MB"
echo "BACKUP_RESTORE_DATABASE_URL в .env.runtime должен указывать на ОТДЕЛЬНУЮ БД, иначе backup.timer не включится"
echo "Если TELEGRAM_OPS_CHAT_ID не задан, watchdog останется рабочим, но будет логировать alerts локально без Telegram"
