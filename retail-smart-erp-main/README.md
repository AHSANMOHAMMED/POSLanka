# POSLanka — Retail Smart ERP & Cloud POS

A high-performance multi-tenant SaaS Point of Sale (POS) and Enterprise Resource Planning (ERP) platform built with **Next.js 16 (App Router)**, **React 19**, and **PostgreSQL 15+**. Specially designed and localized for Sri Lankan businesses across five industry verticals.

📖 **For complete production setup, see the [Production Deployment Guide](docs/PRODUCTION_DEPLOYMENT.md).**

---

## 🌟 Key Features

### Core POS & Retail
- **High-Speed Point of Sale**: Barcode scanning, item variants, unit conversions, and item-level discounts.
- **Sri Lanka Currency & Taxes**: Native LKR formatting, VAT/NBT tax templates, and Sri Lankan banking lists.
- **Multi-Payment Methods**: Cash, Card, Bank Transfer, Cheque, Credit Customer Balance, and Gift Cards with split-tender support.
- **Cashier Session Management**: Cash drawer opening balance, cash reconciliation, and closing entries.
- **PWA Offline Mode**: Automatic IndexedDB queueing with catalog snapshot caching and duplicate-safe server synchronization.
- **Print & Digital Receipts**: ESC/POS thermal printer receipts, PDF downloads, and 1-click WhatsApp document dispatch (`wa.me` & Cloud API).

### Business Verticals Supported
1. **Retail & Supermarket**: Stock takes, batch & expiry tracking, serial numbers, PLU codes, customer loyalty points, and layaway.
2. **Restaurant & Cafe**: Floor plans, table reservations, Kitchen Display System (KDS), modifiers, recipe cost tracking, and waste logs.
3. **Auto Service & Workshop**: Work orders, mechanic assignment, vehicle profiles, inspection checklists, and insurance estimates.
4. **Dealership**: Vehicle inventory, allocations, test drives, financing plans, and warranty tracking.
5. **Backoffice & Accounting**: Double-entry General Ledger, Chart of Accounts, Journal entries, Bank reconciliation, Budgets, and HR/Payroll (EPF/ETF salary slips).

### Multi-Tenant Architecture & Security
- **Subdomain-based Tenant Isolation**: `https://[company-slug].poslanka.lk` rewritten dynamically.
- **PostgreSQL Row-Level Security (RLS)**: Enforces strict data isolation across all companies.
- **Role-Based Access Control (RBAC)**: 15+ roles including a strict **Cashier POS-Only** mode restricting cashiers to billing.
- **Cross-Platform**: Web, Tablet, PWA, and Expo React Native mobile client (`apps/mobile`).

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, Node.js 20+) |
| **UI & Styling** | React 19, Tailwind CSS 4, Lucide Icons, Framer Motion |
| **Database** | PostgreSQL 15+ with Drizzle ORM |
| **Authentication** | NextAuth v5 (JWT strategy) & Bearer Token for Mobile |
| **Real-Time** | Custom WebSocket Server (`ws`) with SSE Fallback |
| **State Management**| Zustand |
| **File Storage** | Cloudflare R2 / AWS S3 |
| **Payment Gateways**| PayHere (Sri Lanka) & WebXPay |
| **Email Delivery** | Resend |
| **Mobile App** | Expo React Native (`apps/mobile`) |

---

## 🚀 Quick Start (Development)

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- npm

### 1. Setup Environment
```bash
cp .env.example .env
```
Edit `.env` and fill in your local database credentials and app secret.

### 2. Install Dependencies
```bash
npm install
```

### 3. Database Initialization
```bash
# Run pending database migrations (123 migrations)
npm run db:migrate

# Create your super admin account for /sys-control
npm run db:seed-admin

# Apply query performance indexes
npm run db:indexes
```

### 4. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📱 Mobile POS Client (Expo)

Located in `apps/mobile`:
```bash
cd apps/mobile
npm install
npx expo start
```
For production build instructions via EAS, see [apps/mobile/README.md](apps/mobile/README.md).

---

## 🔒 Production Deployment

For full production deployment instructions on **Railway**, **VPS/Docker**, or **PM2**, including PostgreSQL RLS setup and DNS configuration, consult:
👉 **[Production Deployment & Operations Guide](docs/PRODUCTION_DEPLOYMENT.md)**

---

## 📜 Available Scripts

```bash
npm run dev              # Start dev server with WebSocket support
npm run build            # Production build
npm run start            # Run production server
npm run lint             # ESLint code style checks
npm run validate:migrations # Validate migration sequencing
npx tsc --noEmit         # TypeScript type checking
npm run db:migrate       # Apply database migrations
npm run db:seed-admin    # Create initial system super admin
npm run db:indexes       # Create performance database indexes
npm run stress:pos       # Run k6 POS load test (5 parallel cashiers)
```

---

## 📄 License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
