# POSLanka — Production Deployment & Operations Guide

This guide covers everything required to deploy, secure, and operate **POSLanka** in production for commercial users, businesses, and cashiers.

---

## 1. Architecture & Multi-Tenancy Model

POSLanka uses a multi-tenant SaaS architecture on Next.js 16 (App Router), React 19, and PostgreSQL 15+.

- **Subdomain-based tenant routing**: Each company accesses their system via `https://[company-slug].poslanka.lk`.
- **Portal & Account Management**: Central signup and cross-company management live at `https://app.poslanka.lk`.
- **Public Marketing Website**: Landing pages and pricing live at `https://poslanka.lk` (or `www.poslanka.lk`).
- **Data Isolation**: Enforced via PostgreSQL **Row-Level Security (RLS)** (`tenant_id = current_setting('app.tenant_id', true)::uuid`).
- **Real-Time Synchronisation**: In-process WebSocket server (`ws://.../ws`) with Server-Sent Events (SSE) fallback on `/_events`.
- **Offline POS Capability**: PWA Service Worker + IndexedDB queue (`pos-queue.ts`) with idempotent server replay.
- **Mobile POS**: Expo React Native client (`apps/mobile`) connecting via Bearer token authentication.

---

## 2. Pre-Deployment Security Checklist (Mandatory)

> [!CAUTION]
> **PostgreSQL Superuser Bypasses RLS by Default!**
> PostgreSQL superusers (e.g. `postgres`) bypass all Row-Level Security policies. To guarantee data isolation between companies, the application **must** switch to a dedicated non-superuser role via `DATABASE_APP_ROLE`.

### Step 1: Create Dedicated Application Role in PostgreSQL
Connect to your PostgreSQL database as superuser (`postgres`) and run:

```sql
-- 1. Create a non-superuser LOGIN role for the application connection
CREATE ROLE poslanka_app WITH LOGIN PASSWORD 'YOUR_STRONG_PASSWORD_HERE';
GRANT CONNECT ON DATABASE poslanka TO poslanka_app;
GRANT USAGE ON SCHEMA public TO poslanka_app;

-- 2. Run the migrations first (as the superuser / DATABASE_URL_ADMIN):
--    npm run db:migrate   # per-file runner (scripts/migrate.mjs); works on a fresh database
SUPER_ADMIN_EMAIL=you@company.lk SUPER_ADMIN_PASSWORD='<min 12 chars>' npm run db:seed-admin   # creates your super admin; then enable 2FA in /sys-control/settings
--    They create the NOLOGIN role `app_user`, grant it CRUD on every table and
--    create the RLS policies. 44 of those policies are written `TO app_user`,
--    so the application MUST act as app_user (or a member of it).

-- 3. Make the login role a member of app_user so it can SET ROLE app_user
GRANT app_user TO poslanka_app;

-- 4. Verify: GET /api/health must report  "tenantIsolation": "app_role"
```

### Step 2: Generate High-Entropy NextAuth Secret
Never reuse development secrets in production:
```bash
openssl rand -base64 48
```
Copy this value to `NEXTAUTH_SECRET`.

---

## 3. Production Environment Variables Reference

Create a `.env` file (or configure environment secrets in your hosting dashboard):

```env
# ==================== Core Application Branding & Domains ====================
NODE_ENV=production
NEXT_PUBLIC_APP_NAME=POSLanka
NEXT_PUBLIC_BASE_DOMAIN=poslanka.lk
NEXT_PUBLIC_LANDING_DOMAIN=poslanka.lk
NEXT_PUBLIC_APP_DOMAIN=app.poslanka.lk
ALLOWED_HOSTS=poslanka.lk,app.poslanka.lk,*.poslanka.lk,localhost

# ==================== PostgreSQL Database (PostgreSQL 15+) ====================
# Connection string using the non-superuser application role
DATABASE_URL=postgresql://poslanka_app:YOUR_STRONG_PASSWORD_HERE@your-db-host:5432/poslanka?sslmode=require

# Role used by withTenant() to enforce RLS. Must be app_user (the role the
# migrations grant privileges and policies to); the login user above must be a member of it.
DATABASE_APP_ROLE=app_user

# Optional admin connection string (used only for initial db:migrate / migrations runner)
# DATABASE_URL_ADMIN=postgresql://postgres:SUPERUSER_PASSWORD@your-db-host:5432/poslanka?sslmode=require

# ==================== Authentication & Session Security ====================
NEXTAUTH_URL=https://app.poslanka.lk
NEXTAUTH_URL_INTERNAL=http://localhost:3000
NEXTAUTH_SECRET=GENERATE_WITH_OPENSSL_RAND_BASE64_48

# ==================== File Storage (Cloudflare R2 / AWS S3) ====================
# Required for item images, company logos, vehicle photos, and receipt attachments
R2_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=poslanka-uploads
R2_PUBLIC_URL=https://cdn.poslanka.lk

# ==================== Email Delivery (Resend) ====================
# Required for staff invites, email verification, and password resets
RESEND_API_KEY=re_YOUR_RESEND_API_KEY
SYSTEM_EMAIL_FROM=noreply@poslanka.lk

# ==================== Sri Lanka Payment Gateway (PayHere) ====================
# Required for SaaS subscriptions & wallet top-ups
PAYHERE_MERCHANT_ID=YOUR_PAYHERE_MERCHANT_ID
PAYHERE_MERCHANT_SECRET=YOUR_PAYHERE_SECRET
PAYHERE_MODE=live
PAYHERE_SANDBOX=false

# Optional secondary gateway: WebXPay
WEBXPAY_API_KEY=
WEBXPAY_API_SECRET=
WEBXPAY_MODE=live

# ==================== WhatsApp Document Sharing ====================
# wa.me link sharing works out-of-the-box without credentials.
# Optional: WhatsApp Cloud API for automated dispatch:
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=

# ==================== AI Assistants (Optional) ====================
DEEPSEEK_API_KEY=
GEMINI_API_KEY=

# ==================== PWA Push Notifications (Optional) ====================
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@poslanka.lk

# ==================== Migration Behavior ====================
SKIP_MIGRATIONS=false
REQUIRE_MIGRATIONS=true
```

---

## 4. Database Setup & Initialisation

Run the following commands in order:

```bash
cd retail-smart-erp-main

# 1. Install dependencies
npm ci

# 2. Run pending migrations (123 migration files)
npm run db:migrate

# 3. Create initial System Super Admin
npm run db:seed-admin
# Follow prompt: sets up email & password for /sys-control access

# 4. Apply high-throughput performance indexes for POS & sales
npm run db:indexes
```

### Tenant isolation check

Run after every migration (and in CI against a migrated database):

```bash
DATABASE_URL=postgresql://... DATABASE_APP_ROLE=app_user npm run db:check-isolation
```

`scripts/check-tenant-isolation.mjs` exits **1** if any `public` table with a `tenant_id` column
has RLS disabled, has no policy for `app_user`, has a policy that does not reference
`app.tenant_id`, or has a nullable `tenant_id`; it also switches to `app_user` with a random
tenant id (rolled back) and fails if any tenant row is visible. Exit code 2 means it could not run.
Documented exceptions live in the script, not in env vars:

- **global+tenant** (`vehicle_types`, `vehicle_type_diagram_views`, `inspection_templates`,
  `inspection_categories`, `inspection_checklist_items`): `tenant_id IS NULL` rows are system
  defaults, readable by every tenant through a SELECT-only policy and never writable by tenant code.
- **account-level nullable** (`account_sessions`, `user_devices`, `ai_error_logs`):
  `tenant_id IS NULL` rows belong to an account, a super admin or the platform and are invisible to tenant code.

Platform tables (`account_tenants`, `subscriptions`, `subscription_payments`, `tenant_usage`,
`account_sessions`, `user_devices`, `ai_error_logs` and the global+tenant tables) also carry a
`platform_login_access` policy: the plain `db` connection (login role, no `app.tenant_id` set)
keeps full access so billing, auth, cron and the super-admin console keep working with a
non-superuser login role. All other tenant tables are visible to the login role only if it is a
superuser or has `BYPASSRLS` (the super-admin console reads several of them with the plain `db`),
so grant `ALTER ROLE poslanka_app BYPASSRLS;` if you connect with a dedicated login role —
`SET ROLE app_user` inside `withTenant()` still enforces RLS because `app_user` has no `BYPASSRLS`.

---

## 5. Domain, DNS & SSL Configuration

To support wildcards for multi-tenancy, configure your DNS provider (e.g. Cloudflare):

| Type | Name | Target / Value | Proxy Status |
| :--- | :--- | :--- | :--- |
| **A / CNAME** | `@` (or `poslanka.lk`) | Railway URL or VPS Public IP | DNS or Proxied |
| **A / CNAME** | `app` | Railway URL or VPS Public IP | DNS or Proxied |
| **A / CNAME** | `*` (Wildcard) | Railway URL or VPS Public IP | DNS or Proxied |

> [!IMPORTANT]
> If using Cloudflare:
> 1. Set SSL/TLS encryption mode to **Full (strict)**.
> 2. Ensure **WebSockets** is toggled ON under **Network**.
> 3. Create a wildcard SSL certificate under **SSL/TLS > Edge Certificates** covering `*.poslanka.lk` and `poslanka.lk`.

---

## 6. Deployment Guides

### Option A: Railway Deployment (Recommended)

1. Connect your GitHub repository to Railway.
2. Select the root directory as `retail-smart-erp-main`.
3. In Railway **Variables**, paste all production environment variables from Section 3.
4. Add a Custom Domain in Railway: `*.poslanka.lk` and `poslanka.lk`.
5. Railway will automatically execute the build and start commands defined in `railway.json`:
   - Build: `npm run build`
   - Post-deploy: `npm run db:migrate`
   - Start: `npm start` (Runs custom server with WebSocket support)
   - Healthcheck: `/api/health`

### Option B: Linux VPS / Docker (Ubuntu 22.04 / 24.04)

1. **System packages**:
   ```bash
   sudo apt update && sudo apt install -y nodejs npm postgresql nginx certbot python3-certbot-nginx
   ```
2. **Build and run via PM2**:
   ```bash
   cd /var/www/poslanka/retail-smart-erp-main
   npm ci
   npm run build
   npm install -g pm2
   pm2 start "node server.js" --name poslanka -i 1
   pm2 save
   pm2 startup
   ```
3. **Nginx Reverse Proxy with WebSocket & SSE Support**:
   ```nginx
   server {
       server_name poslanka.lk app.poslanka.lk *.poslanka.lk;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 86400s;
           proxy_send_timeout 86400s;
           proxy_buffering off;
       }
   }
   ```
4. **Issue SSL certificates**:
   ```bash
   sudo certbot --nginx -d poslanka.lk -d app.poslanka.lk -d *.poslanka.lk
   ```

---

## 7. Operational Scaling & Single-Instance Guidelines

The WebSocket server (`server.ts` / `src/lib/websocket/server.ts`) manages active terminal connections in memory:
- **Single Instance (Recommended for Launch)**: Deploy 1 solid container or VPS with 2GB–4GB RAM and 2 vCPUs. This comfortably handles 100+ concurrent businesses and thousands of daily sales.
- **Multi-Instance / Autoscaling**: If you scale out to 2+ replicas behind a round-robin load balancer, real-time broadcasts on Container A will not reach terminals connected to Container B. Keep to **1 vertical instance** until you attach a Redis Pub/Sub adapter.

---

## 8. Cashier POS Setup & Offline Operation

### Setting Up Cashiers
1. Log into your tenant as an **Owner** or **Manager**.
2. Navigate to **Settings > Staff** (`/c/[slug]/settings/staff`).
3. Click **Add Staff Member** and assign the role **Cashier**.
4. Cashiers are strictly restricted by route guards (`src/app/c/[slug]/layout.tsx`):
   - Allowed: POS terminal (`/pos`), shift reconciliation (`/shift`), my profile (`/my`).
   - Blocked: Accounting, profit margins, cost prices, reports, payroll, and settings.

### PWA Offline POS
- Cashiers can open Chrome/Edge on desktop, tablet, or mobile, and click **Install POSLanka** to add it to their home screen as a standalone PWA.
- If internet drops during a shift:
  1. The catalog snapshot cached in IndexedDB allows continued barcode scanning and cart calculation.
  2. Sales are queued in browser storage with a unique `clientSaleId`.
  3. When connection restores, pending sales sync automatically to `/api/sales`.
  4. The backend checks `client_sale_id` to ensure duplicate sales and double-charging never occur.

---

## 9. Mobile POS Client (`apps/mobile`)

The React Native / Expo app provides a portable handheld POS for Android and iOS devices.

### Local Development
```bash
cd apps/mobile
npm install
npx expo start
```

### Production Build via EAS
1. Set the production API URL in `apps/mobile/.env`:
   ```env
   EXPO_PUBLIC_API_URL=https://app.poslanka.lk
   ```
2. Build Android APK/AAB:
   ```bash
   npm install -g eas-cli
   eas login
   eas build --platform android --profile production
   ```

---

## 10. Routine Maintenance & Backup Protocol

### Database Backups (Daily Cron)
```bash
pg_dump -U postgres -h your-db-host poslanka | gzip > /backups/poslanka_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz
```

### Storage Quota Monitoring
System administrators can monitor tenant storage and database sizes at `/sys-control/vendors`.
Tenants exceeding limits receive automatic in-app alerts and notifications.

