#!/usr/bin/env bash
# POSLanka — server-level PostgreSQL backup with retention (all companies, full database).
#
#   DATABASE_URL=postgresql://user:pass@host:5432/poslanka ./pg-backup.sh
#
# Env:
#   DATABASE_URL        required (use a role that can read every table, e.g. the DB owner — NOT app_user)
#   BACKUP_DIR          default /var/backups/poslanka
#   KEEP_DAILY          daily dumps to keep (default 14)
#   KEEP_WEEKLY         Sunday dumps to keep (default 8)
#   KEEP_MONTHLY        1st-of-month dumps to keep (default 12)
#   S3_URI              optional, e.g. s3://my-bucket/poslanka (DigitalOcean Spaces / S3; needs `aws` CLI)
#   S3_ENDPOINT         optional, e.g. https://sgp1.digitaloceanspaces.com
#   BACKUP_GPG_RECIPIENT optional: encrypt the dump for this GPG key before it leaves the server
#
# Writes <BACKUP_DIR>/{daily,weekly,monthly}/poslanka-YYYYmmdd-HHMMSS.dump (pg_dump custom format,
# compressed, restorable table-by-table with pg_restore) plus a .sha256 file, verifies the archive
# with `pg_restore --list`, then prunes old dumps. Exit code != 0 on any failure (use it in cron
# monitoring). Cron example (02:30 every night):
#   30 2 * * * DATABASE_URL=... /opt/poslanka/deploy/backup/pg-backup.sh >> /var/log/poslanka-backup.log 2>&1
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/poslanka}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"

command -v pg_dump >/dev/null || { echo "pg_dump not found (install postgresql-client matching the server major version)"; exit 2; }

umask 077
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
FILE="$BACKUP_DIR/daily/poslanka-$STAMP.dump"
TMP="$FILE.partial"

echo "[$(date -u +%FT%TZ)] pg_dump → $FILE"
# Full fidelity (schemas public + drizzle migration ledger, RLS policies, grants to app_user).
# --serializable-deferrable: one consistent snapshot without blocking writers.
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=6 --serializable-deferrable --file="$TMP"
pg_restore --list "$TMP" > /dev/null   # archive is readable / not truncated
mv "$TMP" "$FILE"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" --encrypt "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
fi
sha256sum "$FILE" > "$FILE.sha256"

# Promote copies for weekly (Sunday) and monthly (1st) retention
if [[ "$(date -u +%u)" == "7" ]]; then cp "$FILE" "$FILE.sha256" "$BACKUP_DIR/weekly/"; fi
if [[ "$(date -u +%d)" == "01" ]]; then cp "$FILE" "$FILE.sha256" "$BACKUP_DIR/monthly/"; fi

prune() {  # prune <dir> <keep>
  local dir="$1" keep="$2"
  ls -1t "$dir"/poslanka-*.dump* 2>/dev/null | grep -v '\.sha256$' | tail -n +"$((keep + 1))" | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

if [[ -n "${S3_URI:-}" ]]; then
  command -v aws >/dev/null || { echo "aws CLI not found but S3_URI is set"; exit 3; }
  EP=()
  [[ -n "${S3_ENDPOINT:-}" ]] && EP=(--endpoint-url "$S3_ENDPOINT")
  aws "${EP[@]}" s3 cp "$FILE" "$S3_URI/daily/$(basename "$FILE")" --only-show-errors
  aws "${EP[@]}" s3 cp "$FILE.sha256" "$S3_URI/daily/$(basename "$FILE").sha256" --only-show-errors
  # Off-site retention: configure a bucket lifecycle rule (e.g. expire daily/ after 35 days).
fi

echo "[$(date -u +%FT%TZ)] OK $(du -h "$FILE" | cut -f1) $FILE"
