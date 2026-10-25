# Deploying skyERPOS on DigitalOcean (Complete Production Guide)

This guide provides the complete, production-verified step-by-step procedure to deploy and operate **skyERPOS** (`skyERPOS.com`) on DigitalOcean. It covers the **single low-cost vendor setup ($6/mo)**, an **update-wise deployment workflow**, a **growth & load balancer scaling roadmap (up to 500+ vendors)**, and the **unified Excel/XLSX stock import specification** for clothing, watches, fancy items, stationery, groceries, and general merchandise.

---

## 1. Hosting Architecture & Tier Comparison

| Feature | Tier 1: Small Low-Cost (Current Verified Setup) | Tier 2: Medium Growth | Tier 3: Enterprise High Scale |
| :--- | :--- | :--- | :--- |
| **Best For** | **1 to 5 Vendors / Single Store Start** | **5 to 30 Vendors** | **30 to 500+ Vendors / Franchise Chains** |
| **Monthly Cost** | **$6 / month** | **$12 – $24 / month** | **$40 – $70+ / month** |
| **Droplet Plan** | 1 Basic Droplet (1 vCPU, 1 GB RAM, 25 GB SSD) + 4 GB Swap | 1 Resized Droplet (2–4 GB RAM, 1–2 vCPU) | Multiple App Droplets (2 GB RAM each) |
| **Database** | Docker PostgreSQL 16 on same Droplet ($0) | Docker PostgreSQL 16 on same Droplet ($0) | DigitalOcean Managed PostgreSQL 16 ($15+) |
| **Load Balancer** | None (Direct Caddy reverse proxy) ($0) | None (Caddy handles up to 5,000 req/sec) | DigitalOcean Load Balancer ($12/mo) |
| **File Storage** | Local Droplet disk (`ALLOW_LOCAL_UPLOADS=true`) ($0) | Local disk or Cloudflare R2 | DigitalOcean Spaces CDN ($5/mo) or Cloudflare R2 |
| **SSL / TLS** | Automatic On-Demand TLS via Caddy ($0) | Automatic On-Demand TLS via Caddy ($0) | DO Load Balancer TLS + Caddy On-Demand TLS |
| **Live IP** | `168.144.216.104` | Reserved IP / Droplet IP | Floating IP / Load Balancer IP |
| **Domain** | `skyERPOS.com` *(plus direct IP fallback)* | `skyERPOS.com` & `*.skyerpos.com` | `skyERPOS.com` & `*.skyerpos.com` |

> **Recommended Datacenter Region**: Choose **`blr1` (Bangalore)** for the lowest network latency across Sri Lanka and South Asia.

---

## 2. Step-by-Step Droplet Provisioning ($6/mo Droplet)

### Step 2.1: Create Droplet & Configure Firewall
1. Log in to DigitalOcean and create a Droplet:
   * **OS**: Ubuntu 24.04 LTS (x64)
   * **Plan**: Basic &rarr; Regular with SSD &rarr; **$6/month (1 GB RAM / 1 vCPU / 25 GB SSD)**
   * **Region**: `blr1` (Bangalore)
   * **Authentication**: SSH Key (e.g. `~/.ssh/id_ed25519`)
2. Once the droplet is created, note its public IP (e.g. `168.144.216.104`).
3. Connect via SSH:
   ```bash
   ssh root@168.144.216.104
   ```

### Step 2.2: Enable 4 GB Swap Memory (Crucial for 1 vCPU / 1 GB RAM)
Because modern Node.js applications and Next.js require memory headroom during database sync and background tasks, create a 4 GB swapfile:
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify swap is active
free -h
```

### Step 2.3: Configure UFW Firewall & Install Docker
```bash
# Configure UFW
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Install official Docker Engine & Docker Compose
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
```

---

## 3. Application Setup & Low-Memory Production Deployment

### Step 3.1: Repository Structure on Droplet
```bash
mkdir -p /opt/poslanka && cd /opt/poslanka
```

Copy your project code to `/opt/poslanka` (or clone via Git).

### Step 3.2: Environment Configuration (`/opt/poslanka/.env`)
Create `/opt/poslanka/.env`:
```ini
NODE_ENV=production
PORT=3000
SKIP_MIGRATIONS=true

# Branding & Domains
NEXT_PUBLIC_APP_NAME=skyERPOS
NEXT_PUBLIC_BASE_DOMAIN=168.144.216.104
NEXT_PUBLIC_APP_DOMAIN=168.144.216.104
NEXT_PUBLIC_LANDING_DOMAIN=168.144.216.104
ALLOWED_HOSTS=168.144.216.104,localhost,127.0.0.1,skyerpos.com,*.skyerpos.com
BASE_DOMAIN=168.144.216.104
ACME_EMAIL=admin@skyerpos.com

# Database (Internal Docker network - $0 cost)
POSTGRES_DB=poslanka
POSTGRES_USER=poslanka_app
POSTGRES_PASSWORD=YourSecureDatabasePassword2026!
DATABASE_URL=postgresql://poslanka_app:YourSecureDatabasePassword2026!@db:5432/poslanka
DATABASE_APP_ROLE=app_user

# File Storage ($0 - saves uploaded receipts, barcodes, and logos to local disk)
ALLOW_LOCAL_UPLOADS=true

# Auth & Security Secrets
NEXTAUTH_URL=http://168.144.216.104
NEXTAUTH_URL_INTERNAL=http://127.0.0.1:3000
NEXTAUTH_SECRET=generate_with_openssl_rand_base64_48
SECRETS_ENCRYPTION_KEY=generate_with_openssl_rand_hex_32
CRON_SECRET=generate_with_openssl_rand_hex_32

# Gateways (Optional)
PAYHERE_MODE=sandbox
PAYHERE_SANDBOX=true
```

> **Note on Domain Switch (`skyERPOS.com`)**: When you purchase `skyERPOS.com`, simply update `NEXT_PUBLIC_BASE_DOMAIN=skyerpos.com`, `NEXT_PUBLIC_APP_DOMAIN=app.skyerpos.com`, `NEXT_PUBLIC_LANDING_DOMAIN=skyerpos.com`, `BASE_DOMAIN=skyerpos.com`, and `NEXTAUTH_URL=https://app.skyerpos.com`.

### Step 3.3: Caddy Reverse Proxy Configuration (`/opt/poslanka/Caddyfile`)
```caddy
{
	email {$ACME_EMAIL}
	on_demand_tls {
		ask http://app:3000/api/tls-check
	}
}

:80 {
	encode zstd gzip
	reverse_proxy app:3000 {
		header_up X-Forwarded-Proto {scheme}
		transport http {
			read_timeout 0
		}
	}
}

https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy app:3000 {
		header_up X-Forwarded-Proto {scheme}
		transport http {
			read_timeout 0
		}
	}
}
```

### Step 3.4: Docker Compose Configuration (`/opt/poslanka/docker-compose.yml`)
```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-poslanka}
      POSTGRES_USER: ${POSTGRES_USER:-poslanka_app}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-poslanka_app} -d ${POSTGRES_DB:-poslanka}"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build:
      context: ./retail-smart-erp-main
      dockerfile: deploy/digitalocean/Dockerfile.droplet
    image: poslanka:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env
    volumes:
      - uploads_data:/app/public/uploads
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  caddy:
    image: caddy:2.8
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  pgdata:
  uploads_data:
  caddy_data:
  caddy_config:
```

### Step 3.5: Fast Production Build & Deployment Strategy
> [!IMPORTANT]
> **Avoid In-Droplet Compilations**: Compiling a Next.js 16 App Router application directly on a 1 vCPU Droplet can exceed 30 minutes or trigger Linux OOM Killer (`exit code 137`).
> **The Fast Path**:
> 1. Run `npm run build` on your local computer (<2 minutes with Turbopack).
> 2. Sync `.next/` and `server.js` to `/opt/poslanka/retail-smart-erp-main/`.
> 3. Build the runtime container with `Dockerfile.droplet` (which copies the pre-built `.next` artifacts with Node 20 and `tini`).
> 4. Ensure `next@16.1.6` is installed.

---

## 4. Database Initialization & Seeding

```bash
cd /opt/poslanka

# 1. Start PostgreSQL
docker compose up -d db

# 2. Run All 169 Migrations (0000 through 0177)
docker compose exec app npx drizzle-kit migrate

# 3. Enable Row Level Security (RLS) Tenant Isolation Check (Verifies all 229 tables)
docker compose exec app npx tsx scripts/check-tenant-isolation.ts

# 4. Seed Super Administrator Account
docker compose exec app npx tsx scripts/create-super-admin.ts \
  --email="superadmin@skyerpos.com" \
  --password="YourSecureAdminPassword123!" \
  --name="skyERPOS Super Admin"

# 5. Seed Pricing Tiers & Demo Store
docker compose exec app npx tsx scripts/seed-pricing-tiers.ts
docker compose exec app node -e '
  let url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("sslmode", "disable");
  process.env.DATABASE_URL = url.toString();
  require("child_process").execSync("npx tsx scripts/seed-demo-vendor.ts", { stdio: "inherit" });
'
```

---

## 5. Live Production URLs & Login Credentials

| Portal | URL | Default Credentials | Description |
| :--- | :--- | :--- | :--- |
| **API Healthcheck** | `http://168.144.216.104/api/health` | Public | Returns DB status, latency, RLS check |
| **Platform Super Admin** | `http://168.144.216.104/sys-control/login` | `superadmin@skyerpos.com` / `Admin@123456789` | Vendor management, billing, global audit logs |
| **Vendor Business Portal** | `http://168.144.216.104/login` | `admin@demo.poslanka.lk` / `Admin@123456` | Store Director ERP portal (Products, Stock, Sales) |
| **POS Terminal** | `http://168.144.216.104/c/demo-retail/pos` | PIN: `1234` (Admin) or `5678` (Cashier) | High-speed retail barcode/touch checkout |
| **Customer Display (CFD)**| `http://168.144.216.104/c/demo-retail/pos/display`| Linked to POS | Live customer-facing basket display |
| **Kitchen Display (KDS)** | `http://168.144.216.104/c/demo-retail/kds` | Kitchen Staff | Real-time order preparation queue |
| **Self-Service Kiosk** | `http://168.144.216.104/c/demo-retail/kiosk` | Public Kiosk Mode | Self-ordering terminal |

---

## 6. How to Deploy Updates ("Update-Wise Guide")

Whenever you push new code or bug fixes, update your running deployment with zero downtime:

```bash
# 1. On your local machine: build fresh production bundle
npm run build
npx tsx scripts/generate-preview-props.ts   # creates preview-props.json

# 2. Sync compiled bundle to Droplet
rsync -avz --delete .next/ root@168.144.216.104:/opt/poslanka/retail-smart-erp-main/.next/
rsync -avz server.js root@168.144.216.104:/opt/poslanka/retail-smart-erp-main/

# 3. On the Droplet: run new migrations & restart app container
ssh root@168.144.216.104
cd /opt/poslanka
docker compose exec app npx drizzle-kit migrate
docker compose restart app

# 4. Verify health
curl -s http://127.0.0.1:3000/api/health
```

---

## 7. Pointing `skyERPOS.com` Domain When Purchased

Once you purchase `skyERPOS.com` from your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.):

1. In your DNS Management panel, add these DNS records:
   * **A Record**: `@` &rarr; `168.144.216.104`
   * **A Record**: `app` &rarr; `168.144.216.104`
   * **A Record**: `www` &rarr; `168.144.216.104`
   * **A Record**: `*` *(wildcard for vendor subdomains)* &rarr; `168.144.216.104`

2. On the Droplet, update `/opt/poslanka/.env`:
   ```ini
   NEXT_PUBLIC_BASE_DOMAIN=skyerpos.com
   NEXT_PUBLIC_APP_DOMAIN=app.skyerpos.com
   NEXT_PUBLIC_LANDING_DOMAIN=skyerpos.com
   ALLOWED_HOSTS=168.144.216.104,localhost,127.0.0.1,skyerpos.com,*.skyerpos.com
   BASE_DOMAIN=skyerpos.com
   NEXTAUTH_URL=https://app.skyerpos.com
   ```

3. Restart the containers:
   ```bash
   cd /opt/poslanka && docker compose up -d --force-recreate app caddy
   ```
   Caddy will immediately issue trusted SSL certificates via Let's Encrypt for `https://skyerpos.com` and all vendor stores!

---

## 8. Excel / XLSX Stock Import Full Field Specification

skyERPOS features an industrial-grade streaming `.xlsx` importer supporting up to **30,000 items per file**. You can import **clothing, watches, fancy items, stationery, groceries, and electronics all in one unified spreadsheet**.

### 8.1: Column Fields Reference Table

| Column Header (Excel) | Key | Type | Required? | Example Value | Description |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Name** | `name` | String | **Yes** | `Men Casual Linen Shirt - Navy` | Full name of the item. |
| **Selling Price** | `sellingPrice` | Decimal | **Yes** | `4500.00` | Regular retail customer price. |
| **SKU** | `sku` | String | *Recommended* | `CLOTH-SHIRT-M-NAV` | Unique Stock Keeping Unit code. |
| **Barcode** | `barcode` | String | *Recommended* | `479201100101` | Scanner barcode (EAN-13, UPC, Code128). |
| **Item Code** | `itemCode` | String | Optional | `SHIRT001` | Internal short product code. |
| **Category** | `categoryName` | Lookup | *Recommended* | `Clothing` | Automatically maps or links to category. |
| **Cost Price** | `costPrice` | Decimal | Optional | `2800.00` | Wholesale / purchase cost for profit reports. |
| **Unit** | `unit` | String | Optional | `pcs` | `pcs`, `box`, `pack`, `meter`, `kg`. Default: `pcs`. |
| **Brand** | `brand` | String | Optional | `Arrow` / `Casio` / `Atlas` | Brand name. |
| **Track Stock** | `trackStock` | Boolean | Optional | `TRUE` | `TRUE` to track inventory, `FALSE` for services. |
| **Active** | `isActive` | Boolean | Optional | `TRUE` | `TRUE` = active on POS, `FALSE` = hidden. |
| **Warehouse** | `warehouse` | String | Optional | `MAIN` | Warehouse code where stock is deposited. |
| **Opening Stock** | `openingStock` | Decimal | Optional | `50` | Initial stock quantity on hand. |
| **Min Stock** | `minStock` | Decimal | Optional | `10` | Low stock warning threshold. |
| **Reorder Qty** | `reorderQty` | Decimal | Optional | `25` | Default replenishment order quantity. |
| **Description** | `description` | String | Optional | `100% pure cotton, Size M, Slim Fit`| Notes, variants, fabric/color details. |
| **Stock: `<CODE>`** | `stock:MAIN` | Decimal | Optional | `30` | Multi-warehouse per-location opening stock. |

---

### 8.2: Unified Multi-Category Excel Sample (Ready to Copy)

Below is an exact spreadsheet layout with samples across all your store departments (Clothing, Watches, Fancy Items, Stationery):

| Name | SKU | Barcode | Category | Brand | Cost Price | Selling Price | Unit | Opening Stock | Min Stock | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Men Casual Slim Shirt Blue (L)** | `CLOTH-SHIRT-BLU-L` | `89010001` | Clothing | Ralph Lauren | 2800 | 4500 | pcs | 25 | 5 | 100% Cotton, Long Sleeve, Size L |
| **Women Floral Summer Dress (M)** | `CLOTH-DRESS-FLR-M` | `89010002` | Clothing | Zara | 3200 | 5800 | pcs | 18 | 4 | Chiffon, Knee-length, Size M |
| **Boys Denim Jeans 32 Regular** | `CLOTH-JEAN-32` | `89010003` | Clothing | Levi's | 4100 | 6900 | pcs | 30 | 6 | Stretch denim, Dark wash |
| **Casio G-Shock Carbon Core Guard** | `WATCH-CAS-GA2100` | `89020001` | Watches | Casio | 22500 | 32500 | pcs | 8 | 2 | 200M Water Resistance, Black Resin |
| **Fossil Grant Chronograph Leather** | `WATCH-FOS-FS4735` | `89020002` | Watches | Fossil | 28000 | 42000 | pcs | 5 | 1 | Roman numerals, Brown leather strap |
| **Crystal Hair Claw Clip - Golden** | `FANCY-CLIP-GLD` | `89030001` | Fancy Items | Glamour | 350 | 750 | pcs | 100 | 20 | Alloy metal with faux crystal rhinestones |
| **Silk Satin Hair Scrunchie 3-Pack** | `FANCY-SCRUN-3PK` | `89030002` | Fancy Items | SilkTouch | 400 | 900 | pack | 60 | 15 | Pastel pink, cream, and lavender |
| **Korean Style Pearl Earrings Studs**| `FANCY-EAR-PRL` | `89030003` | Fancy Items | Belle | 450 | 1100 | pair | 45 | 10 | Hypoallergenic sterling silver pin |
| **Atlas CR Single Rule Book 200pg** | `STAT-BK-CR200` | `47920001` | Stationery | Atlas | 320 | 480 | pcs | 250 | 50 | 70gsm white paper, hard cover |
| **Faber-Castell Ball Pen 0.7 Blue** | `STAT-PEN-FC-BLU` | `47920002` | Stationery | Faber-Castell | 45 | 80 | pcs | 500 | 100 | Oil gel ink, smooth flow 0.7mm |
| **Maped Metal Geometry Mathematical Set** | `STAT-GEO-MAP` | `47920003` | Stationery | Maped | 650 | 1150 | box | 40 | 10 | Compass, divider, set squares, ruler |

### 8.3: How to Upload the Spreadsheet in skyERPOS
1. Sign in as Store Director at `http://168.144.216.104/login` (or `https://app.skyerpos.com/login`).
2. Navigate to **Inventory &rarr; Items &rarr; Import** (or **Settings &rarr; Import / Export**).
3. Select **Items**.
4. Choose Import Mode:
   * **Insert**: Creates new items (fails if SKU/Barcode already exists).
   * **Update**: Modifies existing items matched by SKU or Barcode.
   * **Upsert**: Creates new items and updates matching existing ones *(Recommended)*.
5. Drag and drop your `.xlsx` file.
6. Review the live column mapping preview and click **Start Import**. The progress bar streams in real-time.

---

## 9. Cost Optimization & Scaling Roadmap

### Stage 1: 1 to 5 Vendors ($6 / month total)
* **Setup**: Single Droplet (`blr1`), 1 vCPU, 1 GB RAM + 4 GB Swap.
* **Database & Storage**: Internal PostgreSQL Docker container + Local file uploads.
* **Monthly Cost**: **$6.00**.

### Stage 2: 5 to 30 Vendors ($12 to $24 / month total)
When you add 10 to 20 retail stores with concurrent POS checkout counters:
* **Action**: Do not buy complex architecture yet. Simply **1-Click Resize** the Droplet in DigitalOcean Dashboard:
  * Select **2 GB RAM / 1 vCPU ($12/mo)** or **4 GB RAM / 2 vCPU ($24/mo)**.
  * Takes <60 seconds. IP address and data remain 100% intact.
* **Monthly Cost**: **$12 – $24.00**.

### Stage 3: 30 to 500+ Vendors (Load Balancer & Managed Database)
When business scales to hundreds of concurrent stores:
```
                          DigitalOcean Load Balancer ($12/mo)
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
            App Droplet #1                            App Droplet #2
         (skyERPOS Web & POS)                      (skyERPOS Web & POS)
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         ▼
                       Managed PostgreSQL 16 Cluster ($15/mo)
                                         │
                                         ▼
                         DigitalOcean Spaces CDN (S3) ($5/mo)
```
* **Stateless App Nodes**: skyERPOS uses stateless JWT sessions. Any Droplet can serve any cashier.
* **Real-time Synchronization**: Cross-droplet POS transactions synchronize instantly using PostgreSQL `LISTEN/NOTIFY` on channel `ws_broadcast`.
* **Zero Downtime Updates**: With a Load Balancer, deploy Droplet #1 while Droplet #2 handles checkout, then switch.
