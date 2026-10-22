# Backups and restore

POSLanka has two independent kinds of backup. Run **both**.

| | Server-level (operator) | Company export (owner self-service) |
|---|---|---|
| What | the whole PostgreSQL database, every company | one company's rows, JSON Lines in a ZIP |
| How | `pg-backup.sh` (pg_dump) or the managed-DB backups | Settings → Backup (`GET /api/export/backup`) |
| Restore | `pg-restore.sh` into a new database | manual / scripted import (see below) |
| Use for | disaster recovery, point-in-time recovery | a company's own archive, leaving the platform, audits |

Uploaded files (item images, attachments, logos) live in object storage (R2 / DigitalOcean
Spaces) and are in **neither** backup. Enable bucket versioning and a lifecycle rule, or mirror the
bucket (`rclone sync`, `aws s3 sync`) to a second region on the same schedule.

## 1. Server-level PostgreSQL backups

### Managed PostgreSQL (DigitalOcean / RDS)

Managed clusters keep daily snapshots and point-in-time recovery (DigitalOcean: 7 days). That
covers "restore the whole cluster to 10:42 yesterday". It does not cover deleting the cluster,
the provider account, or a mistake noticed after the retention window — so also run
`pg-backup.sh` to storage you control.

### `pg-backup.sh`

```bash
# on the Droplet / a backup host with postgresql-client (same major version as the server)
sudo install -d -m 700 /var/backups/poslanka
DATABASE_URL='postgresql://doadmin:…@db-host:25060/poslanka?sslmode=require' \
S3_URI=s3://poslanka-backups S3_ENDPOINT=https://sgp1.digitaloceanspaces.com \
BACKUP_GPG_RECIPIENT=ops@example.lk \
  /opt/poslanka/deploy/backup/pg-backup.sh
```

- Custom-format `pg_dump`, one consistent snapshot (`--serializable-deferrable`, no write locks),
  verified with `pg_restore --list`, `sha256` written next to it.
- Retention (defaults): 14 daily, 8 weekly (Sunday), 12 monthly (1st) — `KEEP_DAILY`,
  `KEEP_WEEKLY`, `KEEP_MONTHLY`. Off-site copies: set `S3_URI` and a bucket lifecycle rule.
- Optional GPG encryption before the dump leaves the server (`BACKUP_GPG_RECIPIENT`).
- Use a database user that can read every table (the owner / `doadmin`), **not** `app_user`
  (row level security would hide every company's rows from it).

Cron (02:30 daily), alert on a non-zero exit or a missing log line:

```cron
30 2 * * * DATABASE_URL=… /opt/poslanka/deploy/backup/pg-backup.sh >> /var/log/poslanka-backup.log 2>&1
```

### Restore (`pg-restore.sh`)

Always restore into a **new, empty** database; switch the app over only after checking it.

```bash
createdb -h db-host -U doadmin poslanka_restore          # or create it in the DO control panel
TARGET_DATABASE_URL='postgresql://doadmin:…@db-host:25060/poslanka_restore?sslmode=require' \
  /opt/poslanka/deploy/backup/pg-restore.sh /var/backups/poslanka/daily/poslanka-20261022-023000.dump
```

The script checks the checksum, decrypts `.gpg` dumps, refuses a non-empty target, creates the
`app_user` role, runs `pg_restore`, re-applies the app-role grants, runs the migrations (brings an
older dump to the current schema) and finally `check-tenant-isolation.mjs` and
`check-schema-drift.ts`. Then:

1. spot-check a few companies (today's sales totals, stock of a few items, last invoice numbers);
2. stop the app (`docker compose stop app`), point `DATABASE_URL` at the restored database
   (or rename the databases), start the app;
3. sales made between the backup and the incident must be re-entered — the mobile / web POS
   offline queues still hold anything that was not synced.

Test a restore at least once a quarter; a backup that was never restored is not a backup.

## 2. Company export (Settings → Backup)

Owner only, at most 3 per hour per company, recorded in the activity log (start and completion).
The ZIP contains `manifest.json` (format, snapshot time, per-table row counts, redacted columns),
`tenant.json`, `tables/<table>.jsonl` for **every** table that has a `tenant_id` column, and
`FILES.txt`. All rows come from one REPEATABLE READ snapshot under the company's row level
security context. Password / PIN hashes, API key hashes, SMTP / SMS / mail provider credentials
and session / push tokens are removed; `account_sessions` is not exported.

### Why there is no one-click restore of a company export

Importing a company export back is deliberately **not** automated:

- rows carry their original primary keys and cross-company references (accounts, roles, plans,
  global vehicle types); restoring into the *same* company would overwrite or duplicate live data,
  and restoring into a *new* company needs every `tenant_id` and every foreign key rewritten
  consistently across ~220 tables;
- passwords, PINs and integration secrets are intentionally not in the export, so a restored
  company would have no usable logins or SMS / e-mail settings anyway;
- document numbering, stock ledgers and the general ledger must stay consistent with each other —
  a partial or repeated import silently breaks them.

For disaster recovery use the server-level dump. To recover **one** company from a server dump
without touching the others: restore the dump into a scratch database with `pg-restore.sh`, then
copy that company's rows table by table (`COPY (SELECT * FROM t WHERE tenant_id = '…') TO …` /
`\copy … FROM`) into the live database inside one transaction, in foreign-key order, after
deleting the damaged rows of that company only. Do this with an engineer, on a copy first.
