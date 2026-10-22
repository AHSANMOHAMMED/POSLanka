#!/usr/bin/env bash
# POSLanka — restore a pg-backup.sh dump into a NEW, EMPTY database (never over a live one).
#
#   TARGET_DATABASE_URL=postgresql://user:pass@host:5432/poslanka_restore ./pg-restore.sh /var/backups/poslanka/daily/poslanka-20261022-023000.dump
#
# Steps: checksum → create roles → pg_restore → migrations (brings an older dump up to the
# current schema and re-applies RLS policies / grants) → tenant isolation + schema drift checks.
# Afterwards point DATABASE_URL at the restored database (or rename databases) and restart the app.
set -euo pipefail

DUMP="${1:?usage: pg-restore.sh <file.dump|file.dump.gpg>}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required (an empty database)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$HERE/../.." && pwd)}"

if [[ -f "$DUMP.sha256" ]]; then sha256sum --check "$DUMP.sha256"; fi
if [[ "$DUMP" == *.gpg ]]; then
  PLAIN="${DUMP%.gpg}"
  gpg --batch --yes --output "$PLAIN" --decrypt "$DUMP"
  DUMP="$PLAIN"
fi

TABLES=$(psql "$TARGET_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [[ "$TABLES" != "0" ]]; then
  echo "Refusing to restore: target database is not empty ($TABLES tables in public). Create a fresh database first."
  exit 2
fi

# The app role used for RLS (DATABASE_APP_ROLE). Created NOLOGIN; migrations grant it.
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN; END IF; END \$\$;"

# --no-owner: objects belong to the restoring user (managed databases rarely have the original
# owner role). Grants to app_user and all RLS policies come back from the dump.
# ALLOW_RESTORE_ERRORS=1 continues past errors (e.g. a foreign key that orphaned rows in the source
# violate) — then fix the data and re-create the constraint by hand; never use it unattended.
STRICT=(--exit-on-error)
[[ "${ALLOW_RESTORE_ERRORS:-}" == "1" ]] && STRICT=()
pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner "${STRICT[@]}" --jobs="${JOBS:-4}" "$DUMP" || [[ "${ALLOW_RESTORE_ERRORS:-}" == "1" ]]
# Safety net, same as drizzle/0073_rls_app_role.sql (in case grants were filtered out).
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
SQL

cd "$APP_DIR"
DATABASE_URL="$TARGET_DATABASE_URL" node scripts/migrate.mjs
DATABASE_URL="$TARGET_DATABASE_URL" DATABASE_APP_ROLE=app_user node scripts/check-tenant-isolation.mjs
DATABASE_URL="$TARGET_DATABASE_URL" npx tsx scripts/check-schema-drift.ts
echo "Restore complete. Verify a few companies (sales totals, stock) before switching DATABASE_URL."
