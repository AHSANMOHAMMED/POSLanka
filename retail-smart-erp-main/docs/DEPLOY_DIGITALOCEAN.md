# Deploying POSLanka on DigitalOcean

Two supported layouts, both using **Managed PostgreSQL** and **Spaces**:

| | App Platform (recommended to start) | Droplet + Docker |
|---|---|---|
| Ops work | None (DO runs the container, TLS, restarts) | You patch the VM |
| Vendor subdomains `<slug>.poslanka.lk` | Wildcard domain (DNS must be on DigitalOcean) | Automatic on-demand TLS via Caddy |
| Approx. monthly cost | App `apps-s-2vcpu-4gb` + DB + Spaces | Droplet 2 vCPU/4 GB + DB + Spaces (cheaper) |
| Files | `.do/app.yaml` | `deploy/digitalocean/` |

Region: **blr1 (Bangalore)** is closest to Sri Lanka; sgp1 also works. Keep the app, DB and Spaces in the same region where possible.

> **Scaling out is supported.** Realtime broadcasts reach every instance through Postgres
> LISTEN/NOTIFY, rate limits and caches are shared through the database, uploads go to Spaces.
> Size the pool so `instances × (DATABASE_POOL_MAX + 2) + ~5` stays below the cluster's
> connection limit (see PRODUCTION_DEPLOYMENT.md §7).

## 1. Create the shared resources

1. **Managed PostgreSQL 16**, Basic 1 GB/1 vCPU or larger, region blr1. Under *Trusted sources*, add the app or Droplet.
   - The default user `doadmin` is enough. It is **not** a superuser and has no BYPASSRLS. Migrations 0073, 0147, 0148 and 0149 make the schema work under exactly that: they create `app_user`, grant it to the login role, and add the platform-access policies.
   - Connect directly on port 25060, or through a connection pool in **Session** mode only. *Transaction* pool mode breaks `SET LOCAL ROLE`, the tenant context and `LISTEN`.
   - Keep `instances × (DATABASE_POOL_MAX + 2)` plus ~5 for the migrate job and admin below the cluster's connection limit. 1 GB plan ≈ 22 usable: 1 instance × 15. 2 GB ≈ 47: 2 × 15 or 3 × 10. 4 GB ≈ 97: up to 4 × 15.
2. **Spaces bucket**, for example `poslanka-uploads` in sgp1, with the CDN enabled. Create an access key under *Spaces Object Storage → Access Keys*.
   - Set `STORAGE_PUBLIC_ACL=public-read`, so logos and item images are readable through the CDN. Keys under `private/` stay private.
   - Set `STORAGE_REGION=us-east-1`. That is what Spaces expects for request signing.
3. **Container Registry** (DOCR), for example named `poslanka`.

## 2. Build and push the image

The Next.js build needs about 6 GB of RAM, so build on GitHub Actions or your own machine, not on a 1 GB builder.

- **GitHub Actions** (`.github/workflows/deploy-digitalocean.yml`):
  - Repository secrets: `DIGITALOCEAN_ACCESS_TOKEN` and `DOCR_REGISTRY`.
  - Repository variables: `NEXT_PUBLIC_BASE_DOMAIN=poslanka.lk`, `NEXT_PUBLIC_APP_DOMAIN=app.poslanka.lk` and `NEXT_PUBLIC_LANDING_DOMAIN=www.poslanka.lk`.
  - Run it from the *Actions* tab, or push a tag `v*`.
- **Manually**:
  ```bash
  cd retail-smart-erp-main
  docker build --build-arg NEXT_PUBLIC_BASE_DOMAIN=poslanka.lk \
    --build-arg NEXT_PUBLIC_APP_DOMAIN=app.poslanka.lk \
    --build-arg NEXT_PUBLIC_LANDING_DOMAIN=www.poslanka.lk \
    -t registry.digitalocean.com/<registry>/poslanka:latest .
  doctl registry login && docker push registry.digitalocean.com/<registry>/poslanka:latest
  ```

`NEXT_PUBLIC_*` values are baked into the browser bundle. If you change the domain, rebuild.

## 3a. App Platform

1. Edit `.do/app.yaml`: set your domain and region, and set `cluster_name` to your DB cluster name.
2. Create the app with `doctl apps create --spec .do/app.yaml`. Later updates use `doctl apps update <id> --spec .do/app.yaml`.
3. In *Settings → Environment variables*, replace every `CHANGE_ME` value (they are stored encrypted).
4. DNS: move the domain's nameservers to DigitalOcean. That is required for the `*.poslanka.lk` wildcard certificate.
5. Each deploy first runs the **migrate** PRE_DEPLOY job:
   - It runs migrations, then the tenant-isolation check, then the schema-drift check.
   - If any step fails, the deploy stops and the old version keeps serving.

## 3b. Droplet + Docker

```bash
# Ubuntu 24.04 Droplet, 2 vCPU / 4 GB, same region; then:
curl -fsSL https://get.docker.com | sh
snap install doctl && doctl auth init && doctl registry login   # pull access to DOCR
mkdir -p /opt/poslanka && cd /opt/poslanka
# copy deploy/digitalocean/{docker-compose.yml,Caddyfile,.env.production.example} here
cp .env.production.example .env.production && nano .env.production
docker compose pull
docker compose run --rm migrate        # migrations + isolation + drift checks
docker compose up -d app caddy
```

- **DNS:** point `poslanka.lk`, `app.poslanka.lk`, `www.poslanka.lk` and `*.poslanka.lk` (A records) at the Droplet.
- **Certificates:** Caddy issues a certificate per host on first visit, but only after `GET /api/tls-check?domain=` confirms that the host is a platform domain or an existing vendor.
- **Firewall:** allow only 22, 80 and 443 (DO Cloud Firewall). Add the Droplet as a trusted source on the database.
- **Updating:** `docker compose pull && docker compose run --rm migrate && docker compose up -d app caddy`. The workflow does this over SSH when `DROPLET_HOST` and `DROPLET_SSH_KEY` are set.

## 4. After the first deploy

```bash
# create the super admin once (inside the running container / App console)
SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... npx tsx scripts/create-super-admin.ts
curl https://app.poslanka.lk/api/health      # expect "tenantIsolation":"app_role", "storage":"s3"
curl https://app.poslanka.lk/api/health/ready
```

- **Cron:** set the GitHub secrets `CRON_SECRET` and `APP_URL` so `.github/workflows/cron.yml` drives `/api/cron/*`. This includes `einvoice-sync` every 10 min and `auto-reorder` daily at 02:30 Asia/Colombo (both `POST`, `Authorization: Bearer $CRON_SECRET`; see PRODUCTION_DEPLOYMENT.md → Scheduled Jobs). `EINVOICE_TRANSMITTER` defaults to `disabled` (queue only).
- **Backups:**
  - Managed PostgreSQL keeps daily backups with 7-day point-in-time recovery.
  - App Platform cannot schedule `deploy/backup/pg-backup.sh`. For copies outside the provider run it daily from a small Droplet (system cron) or a scheduled CI job, to a bucket you control — see `deploy/backup/README.md`.
  - Enable versioning or lifecycle rules on the Spaces bucket.
- **Retention:** `/api/cron/retention` (daily, in `cron.yml`) deletes old activity / error / notification logs in batches; policy in PRODUCTION_DEPLOYMENT.md → Data retention.
- **Monitoring:**
  - App Platform: readiness `health_check` on `/api/health/ready`, `liveness_health_check` on `/api/health/live` (both in `.do/app.yaml`). DO's uptime check on `/api/health`.
  - Set `METRICS_TOKEN` and scrape `GET /api/metrics` (Bearer) per instance, or just watch the JSON logs (`slow query`, `slow request`, `request failed` lines carry the `requestId`).
  - Alert policies for CPU and memory on the app or Droplet, and for connections and disk on the DB.

## Environment reference (DigitalOcean-specific)

| Variable | Value |
|---|---|
| `DATABASE_URL` | cluster connection string (`?sslmode=require`); App Platform: `${poslanka-db.DATABASE_URL}` |
| `DATABASE_CA_CERT` | the cluster CA (PEM, `\n` allowed). Enables full certificate verification. App Platform: `${poslanka-db.CA_CERT}` |
| `DATABASE_SSL` | optional override: `verify` / `no-verify` / `disable`. Without a CA, `ondigitalocean.com` hosts use encrypted SSL without verification. |
| `DATABASE_POOL_MAX` | pooled connections per instance (default 15; each instance also holds 2 LISTEN connections) |
| `METRICS_TOKEN` | enables `GET /api/metrics` (Bearer); unset = 404 |
| `DB_STATEMENT_TIMEOUT_MS` / `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | per-connection limits (defaults 30000 / 60000, `0` = off) |
| `DATABASE_APP_ROLE` | `app_user` (created by the migrations) |
| `STORAGE_*` | Spaces endpoint, region `us-east-1`, bucket, CDN URL, `public-read` ACL and access keys |

See `.env.example` for everything else (email, PayHere, push, AI).
