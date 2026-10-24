# POSLanka — implementation status after the "full app wiring" pass (2026-10-20)

## Runtime verification performed (2026-10-20)
A fresh PostgreSQL 16 database was created, all 124 migrations were applied with `npm run db:migrate`, the production build was started (`node server.js`) and an end-to-end API smoke test was run: super-admin login → create vendor → mobile login → realtime token → items/barcode/PLU lookup → open shift → cash sale → idempotent retry → split tender → hold/resume → return → PIN set/verify/supervisor → close shift with zero variance → cross-vendor analytics → page renders. The mobile app was bundled for Android with Metro (Hermes bytecode produced). Results are in the final section.

## Defects found and fixed during runtime verification
- **Fresh database could not be migrated**: six tables were created twice, FK/enum/column/policy duplicates aborted the chain, the `app_user` role was referenced before it existed, and `0099` referenced a dropped table. All migration files are now idempotent and `0026` creates `app_user` if missing.
- **`drizzle-kit migrate` wraps all files in one transaction**, which PostgreSQL rejects when a file adds an enum value and uses it. `npm run db:migrate` now runs `scripts/migrate.mjs` (same `__drizzle_migrations` table, per-file application, advisory lock). `npm run db:migrate:drizzle` keeps the old behaviour.
- **Shift close counted every sale twice** (sale total plus its payment rows) and recorded the cash *tendered* instead of the cash *kept*, so expected cash and variance were wrong for every cashier. Both fixed; payment methods used in sales but not declared at opening (e.g. card) are now included in the shift totals and reconciliation.
- **Returns were rejected** by the sale schema (`subtotal`/`total` must be ≥ 0) although the POS sends negative return totals. The schema now allows negatives only when `isReturn` is true.
- **Tenant isolation depends on `DATABASE_APP_ROLE`**. With a superuser connection and no app role, RLS is bypassed and tenants can see each other's data (observed in the test: a new vendor hit "category already exists" from another vendor). `.env.example` now sets `DATABASE_APP_ROLE=app_user`, `GET /api/health` reports `tenantIsolation`, the server logs a security error when unsafe, and the deployment doc was corrected (`poslanka_app` must be a member of `app_user`).
- Mobile: `expo-asset`, `expo-constants`, `expo-font` and `query-string` were missing and the Metro bundle failed; added.

## Database migration to run
`npm run db:migrate` applies `drizzle/0123_users_pin_items_plu_index.sql`:
- `users.pin_hash` — 4–6 digit POS PIN (set per staff member in Settings → Staff → Edit).
- `idx_items_tenant_plu_code` — exact PLU lookups for scan.
- trigram indexes on `items.name / sku / barcode` (needs the `pg_trgm` extension; the migration skips them with a NOTICE if the DB user cannot create extensions — ask the DBA to run `CREATE EXTENSION pg_trgm` then re-run the three `CREATE INDEX` statements).

## Web POS (`/c/[slug]/pos`)
- Keyboard shortcuts: **F1** focus search · **F2** hold sale · **F3** held sales · **F4** discount · **F6** return · **F8** lock terminal · **F9** pay · **Enter** in the search box = instant barcode/PLU/SKU lookup and add · **Esc** clears search · **Ctrl+Delete** clear cart (confirm) · in the payment sheet **Enter** completes the sale, **Esc** closes.
- Scan fast path: Enter calls `/api/items/barcode-lookup` immediately (no 300 ms debounce); exact SKU/PLU/barcode match or a single visible result is auto-added.
- Supervisor override (`POST /api/auth/verify-pin`, scope `supervisor`, permission `manageSales`): discount above the counter's max %, price change when the counter profile forbids rate changes. Approver's name is recorded in the discount reason.
- Terminal lock (`/api/auth/verify-pin`, scope `self`): F8 or idle for N minutes (`localStorage poslanka:pos-lock-minutes`, default 10); "Switch user" signs out.
- Idempotency: every cart gets one `clientSaleId` (online, offline and returns); the server returns the existing sale on a retry.
- Offline: catalog snapshot for the shift's branch (up to 2,000 items) is warmed in the background and merged by id; when offline or on network failure the grid serves from the snapshot with local search.
- Customer display (`/c/[slug]/pos/display`) mirrors the live cart over `BroadcastChannel` + `localStorage`.
- The top context bar now shows real data: branch, counter, cashier, online/offline, shift number.

## Backend
- `ws-token`, `heartbeat`, `validate` accept the mobile Bearer token (realtime now works for the app).
- `mobile-login`: rate limited (5 / 15 min per tenant+email+IP), records `lastLoginAt`.
- `PUT /api/users/[id]` accepts `pin` (hashed; empty string clears).
- New `POST /api/auth/verify-pin`.
- Super admin: `POST /api/sys-control/vendors` provisions tenant + owner + MAIN warehouse + default counter in one transaction (audited); `PUT /api/sys-control/vendors/[id]` validated + audited; `GET` paginated with SQL search and no N+1; new cross-vendor analytics `GET /api/sys-control/analytics/{sales,live,vendors/[id]}`.

## Web pages now on real data
KDS (`/kds`), self-service kiosk (`/kiosk`), customer display (`/pos/display`), super-admin overview, live sales wall, vendor list / dossier / create.

## Mobile
See `apps/mobile/README.md`. All screens call real endpoints with schema-valid payloads; `npm run typecheck` passes against real dependency types.

## Final verification results
| Check | Result |
|---|---|
| Web typecheck / lint / production build | 0 errors / 0 errors / success |
| Mobile typecheck (real Expo types) / Metro Android bundle | 0 errors / bundle produced |
| Fresh database migration (124 files, `npm run db:migrate`) | complete, idempotent re-run reports up to date |
| API smoke test (72 checks, under `DATABASE_APP_ROLE=app_user`) | 72 / 72 passed |
| `GET /api/health` | `tenantIsolation: app_role` |
| 5 cashiers × 20 concurrent sales + 5 racing duplicate submissions (25 parallel) | 105 / 105 OK, 101 distinct invoices (100 + 1 for the duplicate), stock exactly 500 − 101, every cashier closed with zero variance, p95 1.6 s on a laptop container |

## Round 3 — barcodes, printers, push, 2FA (2026-10-20)
- **Barcode engine** `src/lib/inventory/barcode-parse.ts` (self-test `npx tsx src/lib/inventory/__barcode_selftest__.ts`): EAN-13/8, UPC-A, UPC-E expansion, ITF-14/GTIN-14, Code 128/39 SKUs, QR payloads, GS1-128 / GS1 DataMatrix (GTIN, batch, expiry, production date, serial, net weight, count, price), weighing-scale price/weight labels with a per-vendor layout (`PUT /api/tenant { scaleBarcode }`, UI in Barcode → Settings). `GET /api/items/barcode-lookup` resolves all of them in one query and returns a `scan` object (`symbology, quantity, unitPrice, batchNo, expiryDate, gtin, matchedBy`); web POS and mobile add scale weights automatically; GRN "scan to receive" prefills batch/expiry/qty.
- **Receipt printers (web)**: ESC/POS encoder (`src/lib/print/escpos/`, 54 self-tests) with CODE128 + QR, drawer kick, 58/80 mm, Sinhala/Tamil as bitmap; transports WebUSB, Web Bluetooth, local Print Agent (`tools/print-agent`, TCP 9100 / system printer / serial) and browser print fallback; Printer settings modal in the POS top bar; auto-print on sale, Z-report on shift close.
- **Receipt printers (mobile)**: see `apps/mobile/README.md` — Bluetooth / USB / TCP via `react-native-thermal-receipt-printer-image-qr` (needs an EAS dev-client build), `expo-print` system fallback, printer settings screen, auto-print, Z-report.
- **Camera scanning on web** (`BarcodeDetector`, 12 symbologies) and mobile (all expo-camera symbologies, torch, haptic).
- **Push notifications**: `user_devices` table, `POST/DELETE /api/account/devices`, Expo Push sender (`src/lib/notifications/push.ts`); triggers: requisition submitted → approvers, advance requested → HR approvers, shift closed with variance → managers, item at/below branch minimum after a sale → stock managers. Set `EXPO_ACCESS_TOKEN` optionally.
- **Super admin**: TOTP 2FA (`/api/sys-control/auth/2fa`, card in Settings, code field on login), bearer-token mobile login (`/api/sys-control/auth/mobile-login`), mobile companion screens (Pulse, Live, Vendors, Payment approvals). Hard-coded default password removed from the admin login page; `db:seed-admin` now requires `SUPER_ADMIN_EMAIL/PASSWORD`; the original project's built-in super admin (migration 0029) is no longer created on fresh installs and is deactivated on existing databases (0125).

## Final verification (round 3)
| Check | Result |
|---|---|
| Web typecheck, lint, production build | 0 errors, 0 errors, success |
| ESC/POS encoder self-test | 54 / 54 |
| API smoke test incl. barcode types, scale labels, push devices, admin 2FA and mobile login | 100 / 100 |
| 5 cashiers, 105 concurrent checkouts with racing duplicates | 105 / 105, invoices and stock exact |
| Mobile typecheck, Android Metro bundle, prebuild config | 0 errors, bundle produced, plugins resolve |

Fixed in this round: super-admin mobile login no longer logs out the web console session (sessions are scoped per channel); the printer driver's missing `react-native-ping` peer (would have crashed the app at launch) is installed and pinned with `apps/mobile/.npmrc`; `expo-dev-client` and `apps/mobile/eas.json` added for device builds.

## Browser verification (round 4)
A real Chrome browser drove the production build: vendor login, open shift from the POS, F1 search, Enter-scan of an EAN-13, a weighing-scale label (0.750 kg priced correctly), F4 discount, F9 pay, Enter to complete, F2 hold, F3 held list, F8 lock and PIN unlock, ten vendor pages and fourteen super-admin pages. Result 41/41 with zero browser errors and zero server errors.

Fixed from this pass:
- Escape did not close 13 POS dialogs (discount, held sales, returns, weight, serials, modifiers, printer, camera, supervisor, cash float, vehicle mismatch, success, held drawer), which blocked every keyboard shortcut after opening one. New `useEscapeKey` hook; the success screen also accepts Enter for the next sale.
- Vendors created from the super-admin console had no billing account, membership, subscription or usage row, so every vendor page raised an error and billing/trial/storage enforcement skipped them. Creation now mirrors self-registration; migration 0126 backfills existing ones.

## Round 5 — vendor operations (2026-10-21)
Delivered in three waves, each verified on a fresh database (migrations 0127–0142) before commit.

| Area | What vendors get |
|---|---|
| Staff | Owner/manager creates admins and cashiers with password, PIN, branches and counters (web + mobile); invites keep assignments |
| Item identity | Auto item code `ITM-000001`, unique barcode per vendor, unique PLU; duplicates rejected with a clear 409 |
| History | Every stock change records who, when, before → after; field and price changes logged; History tab per item |
| Stock intake | Mobile/web staging batches (works offline), Sync adds stock or creates items without duplicates; failed lines fixable and re-syncable |
| Import/export | Validate-then-apply, no lost rows, upsert, blank cells keep values, opening stock per branch, resumable jobs, error CSV, unlimited export |
| Alerts | Low/out-of-stock from any stock change, expiry, daily digest, large refund, void, manual return, shift variance, intake, offline-sale issues, subscription expiry; per-user types, quiet hours, digest hour; web + mobile inbox |
| Offline (power cut) | Phone keeps a local catalog per branch; search, scan (incl. scale/GS1 labels), sell, print with an `OFF-` receipt code; syncs later without duplicates |
| Receipts | Editable business profile (logo, legal name, VAT/TIN, BRN, website), per-counter settings, invoice barcode/QR on every receipt path, Z-report with the same header |
| Printers & labels | Multiple printers per terminal (receipt/label/kitchen); TSPL, ZPL, EPL and raster labels on web and mobile; kitchen tickets |
| Returns | Locked, server-priced refunds with tax reversal; partial returns; exchange; line removal as a recorded return; scan receipt barcode to return (web + mobile) |
| Purchases | Receive/return/cancel keep ledger and stock in agreement; weighted-average cost across branches |
| Isolation & security | RLS on every vendor table (checker in CI); several cross-vendor leaks closed; password/PIN hashes no longer returned by any API |
| Scale | Per-vendor invoice numbering (no global lock); 105 concurrent checkouts pass with exact stock and invoices |

Verification on the final build: 18 test suites (1,757 checks), API smoke 100/100, concurrency 105/105, browser 41/41, lint 0/0, web + mobile typecheck 0, Android bundle OK. CI runs all suites on a fresh PostgreSQL.

## Round 6 — closing every open item (2026-10-21)
- **Batches & expiry:** every sale path (POS, exchange, restaurant, sales-order, work-order, layaway) allocates earliest-expiry-first and records the batch; returns and voids restore the same batch. Expired batches blocked unless the vendor allows them.
- **Returns:** optional quarantine location for returned goods; serial return status setting.
- **Accounting:** split-payment sales post one debit per method; cash sales post the amount kept (not tendered); gift-card and store-credit splits fixed.
- **Purchasing:** invoice cost updates, exact cost and PO reversal on cancel/delete; purchase invoice ↔ PO link actually stored.
- **Document numbers:** all 28 series per vendor via `tenant_sequences`; no global locks left.
- **Kitchen:** delta tickets (`+3`, `VOID 1`), decimal quantities, mobile kitchen tickets for restaurants.
- **Mobile:** vendor currency on labels, branded Z-report, Android back in printer editor, offline stock reflects unsynced sales, 6-character device codes with conflict-safe lookups.
- **Platform:** Next.js `proxy` (deprecation gone), live alert bell over WebSocket, per-vendor hiding of shared vehicle types/templates, 100,000-row imports.
- **Scale fix (migration 0145):** usage counters no longer lock one shared row per vendor on every insert (they append deltas folded on read and every 15 minutes), the invoice number and stock rows are locked only at the end of a sale. 25 simultaneous same-item checkouts: p50 1.9 s → 1.06 s, p95 3.3 s → 1.3 s; different vendors never block each other.

Final verification: fresh database 0000–0145, 22 suites / 1,947 checks, API 100/100, concurrency 105/105, browser 41/41, lint and typecheck clean, Android bundle OK, build without warnings.

## Still open
- Not exercised on physical hardware: a real Android phone, Bluetooth/USB/network thermal printers, cash drawers, USB/Bluetooth scanners, weighing scales. These need an EAS build (`apps/mobile/README.md`) and an on-site test.
- Push needs `npx eas init` (EAS project id) before notifications are delivered.
- Web WebUSB on Windows may need the WinUSB driver (Zadig); otherwise use the Print Agent in `tools/print-agent`.

## Round 8 — ERP/POS production gap audit (2026-10-22)
Audited against a "POS is the capture layer, ERP is the system of record" checklist; every gap found was implemented. Migrations 0157–0161 (and 0151–0156, which were missing from the journal and never ran).

| Area | What changed |
|---|---|
| Cash control (0157) | Paid-in / paid-out / bank drop during a shift with reasons, supervisor approval and GL; one open shift per user and per counter (unique indexes); sales tied to the cashier's open shift; per-method variance posted to each method's account with a required reason; full Z-report (tax, discounts, voids, returns, cash movements, GL tie-out); voids after close refund from the voider's open shift without touching the closed Z |
| Server-side approvals | `verify-pin` issues single-use signed tokens; discount limits, price cuts below the resolved price and credit-limit overrides are enforced in `POST /api/sales` and exchanges; approver, list price, terminal and before/after values recorded |
| Sri Lanka tax (0158) | VAT 18% (NBT removed), zero-rated / exempt / out-of-scope categories, optional SSCL 2.5%, one-click fix for tenants on the old 15%; TAX INVOICE / CREDIT NOTE with supplier and buyer VAT numbers and per-line VAT (web, PDF, mobile 58/80 mm); per-invoice output and input VAT schedules with CSV and GL reconciliation; credit and debit notes with GL; e-invoice outbox + cron ready for IRD RAMIS (transmitter disabled until the API is published) |
| Procure-to-pay (0159) | GRN posts to Stock Received But Not Billed; invoice clears it with price variance; 3-way match (warn/block, tolerances); landed cost vouchers; reorder with on-order, reserved and max stock, draft POs from suggestions and optional daily auto-reorder; adjustment reason codes with optional GL mapping; inventory-GL vs valuation audit check and report |
| Platform (0160) | Web offline queue never drops sales (dead-letter list, backoff, OFF- receipt numbers, offline receipt printing); owner tenant backup ZIP and server pg_dump/restore scripts; API keys + `/api/v1` (items, stock, customers, idempotent sales) — see `docs/API.md`; cash variance and open shifts on the dashboard; cost prices and purchasing data hidden from cashiers; password hashes no longer leaked by 15 relation includes |
| Pricing & catalog (0161) | Price lists (customer group / customer / counter, tiers, dates), promotions (BOGO, buy X get Y, bundle, min spend, schedules, coupons, usage limits) applied by the server, online and offline on web and mobile; multiple barcodes per item; units of measure with conversions (stock always in base units); product type; promotion report |

Verification on a brand-new database: migrations 0000–0161 apply and re-run as a no-op, isolation and drift checks OK, 40 suites all passing (new: h1 71, h2 79, h3 58, h4 86, h5 105), web and mobile typecheck 0 errors, lint 0, production build OK.

Still open: hardware tests from earlier rounds; IRD e-invoicing transmitter (waiting for the published API spec); mobile return lines don't display the unit; the offline web receipt is typechecked but not yet browser-tested.

### Round 8b — page load speed (2026-10-22)
Measured in a real browser (22 page loads): **dev** 1,550 → 529 API requests, page settled 2–6 s → 0.6–1.2 s; **production** 841 → 438 requests, 0.6–0.85 s → 0.3–0.46 s, sidebar clicks 0.1–0.2 s.
- The whole app rendered nothing until a session check round-trip finished (`SessionValidator`); it now renders immediately (the server layout already authenticated the request) and checks in the background.
- Module access, feature flags and the shell widgets (banners, chat, alerts, inbox, company switcher) share one request per page via `src/lib/client/shared-fetch.ts`; low-priority widgets load after the page's own data.
- `useRealtimeData` no longer polls 0–3 s after mount while the WebSocket is still connecting (it fetched every list twice).
- Instant click feedback: top progress bar (`NavigationProgress`) and a `loading.tsx` skeleton for company pages.
- Dev: `server.ts` loads `.env.local` (it only read `.env` before and exited with "DATABASE_URL is required"); the main modules are pre-compiled in the background (`src/lib/dev/warmup.ts`, capped at 3.5 GB — compiling every route pushed `next dev` past 9 GB and the OS killed it). `npm run preview` runs the app locally in production mode.
- The onboarding checklist linked to a non-existent `/settings/users` page (now `/settings/staff`).

## Round 9 — super-admin console, roles, Business ID, production hardening (2026-10-22)
Migrations 0162–0168.

| Area | What changed |
|---|---|
| Business ID (0162) | Every vendor gets a permanent ID like `PL-985633` (DB default, backfilled, immutable). Staff sign in with it on the web (`/login` → Staff sign-in) and mobile; shown on the staff page, business profile, vendor login page and admin console. |
| Super-admin console | Rebuilt on one design kit (`src/components/admin/kit`), light/dark, collapsible on phones; all fake telemetry removed (fake IPs, "142 vendors online", uptime, cluster health, displayed TOTP code, lockdown button…). Real health API (`/api/sys-control/health`). Vendors: search by Business ID, detail tabs, real lifecycle actions (suspend/reactivate, extend trial, change plan, reset owner password, resend welcome, single-use audited impersonation, soft archive). Users, audit log (filters + CSV), error log (resolve/ignore/reopen), broadcasts/email by plan/type/Business ID, settings. Forced password change / required 2FA enforced on every admin API (0166). |
| Billing fixes | Renewals now extend plan expiry; payments no longer reactivate admin-suspended vendors; manual lock no longer schedules data deletion; wallet top-ups credit once; slip approval idempotent; tier price edits don't change existing subscribers; unlock no longer gives a free month unless chosen. |
| Vendor roles | Owner/managers with `manageRoles` create admins, cashiers and custom roles; nobody can grant more than they hold; owner protected; module switches enforced by the server (incl. read endpoints) and the sidebar; invites carry custom roles; permission changes apply instantly across processes. Mobile app screens follow each role's effective permissions. |
| Sign-in pages | Admin, vendor staff, root, register, forgot/reset, invite rebuilt: visible labels, no icon overlap, brand-consistent, responsive. |
| Non-functional (0167–0168) | Realtime fan-out and rate limits across instances (Postgres LISTEN/NOTIFY, DB rate limits) → horizontal scaling supported; statement/idle-transaction timeouts; 22 indexes; real health/live/ready probes; graceful shutdown; PayHere activation atomic; CSRF Origin check; upload signature checks + 20 MB limit; JSON logs with request IDs; `/api/metrics`; retention cron; outbound timeouts; xlsx CVE fixed, unused three.js removed. |
| Bug found in verification | A sign-in in the same second the password was set (every new vendor owner, reset-then-login) was randomly rejected (1-second token precision). Tokens now carry a millisecond sign-in time. |

Verification (fresh DB 0000–0168): 44 suites pass (new: i2 80, i3 71, i4 94, i5 84); web + mobile typecheck and lint clean; production build OK; all 14 admin pages and 45 vendor pages have no horizontal overflow at 390/768 px and settle in < 0.6 s; load test 105/105 concurrent checkouts (p95 1.4 s), exact stock and invoices, zero variance.

Ops must set: `METRICS_TOKEN`, S3 storage credentials (or `ALLOW_LOCAL_UPLOADS=true` on a single host), custom domains in `ALLOWED_HOSTS`; see `.env.example` and docs/DEPLOY_DIGITALOCEAN.md. Open: platform-admin roles (every admin has full access), promo codes not applied at checkout, PayHere refunds via the PayHere portal, broadcast push notifications, `npm audit` items in drizzle-orm/@auth/core.

## Round 10 — security updates and remaining features (2026-10-23)
- **Dependencies:** critical `@auth/core` advisory fixed (next-auth 5.0.0-beta.32 / @auth/core 0.41.3; patch renamed to `patches/next-auth+5.0.0-beta.32.patch`), Next.js 16.4.2, drizzle-orm 0.45.4, sharp 0.35.5 (libvips/libheif/librsvg CVEs), `exceljs` → uuid 11 via override, unused `query-string` removed. Remaining web advisories are install/CLI-only (`braces` via patch-package, `sprintf-js` via mammoth's CLI). Mobile advisories are all Expo build tooling and need an Expo SDK upgrade (`npm audit fix --force`), planned separately.
- **Platform-admin roles (0169):** owner / support / billing / viewer, enforced per route (`validateAdminSession(permission)` — a route without a permission does not compile), last owner protected, role changes audited; console and mobile admin follow the role.
- **Promo codes at checkout:** applied server-side on PayHere, wallet and bank-slip payments; one redemption per payment (PayHere retries can't double count).
- **PayHere refunds:** full refunds from the console (billing/owner), idempotent, audited; the admin chooses what happens to the subscription. Needs `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET` (PayHere Business App with refund permission).
- **Broadcast push:** "Push to phones" channel via Expo push, per-vendor delivery status; broadcast links clickable in the web bell and mobile inbox.
- **Mobile returns** show the unit and conversion (e.g. 1 Box = 12 pcs).
- **Verified in a browser:** web POS offline sale → `OFF-…` receipt number → receipt printed → synced once on reconnect.

Verification: fresh DB 0000–0169, 45 suites pass (new i6 61/61), web + mobile typecheck and lint clean, production build OK, admin and vendor pages without overflow and < 1 s.

## Round 11 — Android APK, vendor page, crash fixes, partial refunds (2026-10-23)
- **Android APK:** `apps/mobile` builds a release-signed APK locally with `npm run build:apk` (no Expo account; key in `~/.poslanka-keys`, not in git — back it up). New architecture, React Native 0.76.9, codegen before the C++ build, server URL inlined (`EXPO_PUBLIC_API_URL`), cleartext allowed for shop LAN servers. Verified on an Android 16 emulator: Business ID sign-in → Mobile POS with live data. `releases/POSLanka-1.0.0.apk` (Git LFS) predates the receipt-conversion change below; the next `npm run build:apk` includes it.
- **Super-admin vendor page:** every tab and action verified in a browser (`scripts/e2e-live/ui-vendor-page.cjs`, 28/28). Fixed: all server redirects pointed at `http://0.0.0.0:<port>` (now `publicUrl()`: the browser's trusted host, else `NEXTAUTH_URL`), and the Features tab could not save a switch back without a reload.
- **"Cannot read properties of null (reading 'removeChild')":** the staff sign-in page no longer edits/removes the React-owned `<link rel="manifest">`; the app opts out of browser auto-translation (`translate="no"`, `notranslate`), which rewrites text behind React.
- **PayHere partial refunds:** optional amount, running total, `partial` status until fully refunded (PayHere Refund API `amount`).
- **Mobile receipts** print the unit conversion under the item ("1 Box = 12 pcs") on 58/80 mm and HTML receipts.
- **Tests follow the new rule** that stock intake is for stock staff only (c3-writers, i2-roles).
- **Permission cache races fixed:** a role change landing during a cache load no longer leaves stale permissions for 5 minutes, and an invalidation no longer makes a request fall back to role defaults (it marks the entry stale instead of deleting it). Module access invalidates after commit.

Still open: Expo SDK upgrade (only remaining npm advisories are in Expo's build tooling), IRD RAMIS transmitter (no public API yet), hardware tests (phones, printers, scanners, scales).

## Round 12 — vendor setup, staff, data console, feature switches, pharmacy, multi-department stores (2026-10-24)
- **POS:** Bills History labels Print / WhatsApp on phones; ~10% larger POS text; shift-open errors name the counter that is in use.
- **New vendor:** only name, phone and address required; web address, owner name, login (`owner@<slug>.poslanka.local`) and password are filled in (password shown once).
- **Staff per vendor:** super admin adds managers / cashiers / … per vendor (web and app), gives new passwords, deactivates; staff anywhere need only name + role (login from the name, generated password).
- **Vendor data console** (`/sys-control/vendors/[id]/data`, app: vendor → All data): every tenant table (221) with search and add / edit / delete, kept inside the vendor (RLS + tenant filter), secrets hidden, logs read-only, every change audited with before / after.
- **Feature switches:** 27 real switches in 5 groups (was 8 that only hid links), enforced on menus, direct URLs, the API (proxy → 403 `FEATURE_DISABLED`), the POS (credit, gift cards, loyalty, coupons, WhatsApp, scales) and the app; grouped Features tab on web and app.
- **API wiring audit** (1,682 call sites): fixed POS float / safe drop (now real cash movements), bank "Reconcile matched", GL account filter, commission matrix, recipe ingredients, salary component toggle, Plans → change plan, purchase-requisition cancel, file tags, commission cancel reasons.
- **Pharmacy (0170):** business type, generic name / strength / dosage form / drug schedule, generic-name search (web, app, offline), prescription capture for prescription / controlled medicines (web POS before payment, app on PRESCRIPTION_REQUIRED, enforced by `POST /api/sales`), Prescription Register, Expiry Report, pharmacy categories / accounts / terminology.
- **Multi-department stores:** supermarket starts with grocery + clothing, footwear & slippers, bags, stationery, fancy departments; retail with clothing / footwear / bags / stationery / fancy; size × colour variant generator (own code, barcode, stock), POS shows products and opens the size picker; departments, scales, category sales and item velocity for retail, supermarket and pharmacy.

Verification: fresh DB 0000–0170 — j1 38/38 (new), i3 96, i5 vendor data 32, w1 45, gA 37, h1 71, h5 105, w6 51, gG 39; RLS isolation and drift checks OK; web + mobile typecheck and lint clean; browser: vendor creation, staff, data console (desktop + phone), feature switch 403, pharmacy POS → prescription → register.

## Round 13 — one sign-in, POS keyboard, cheques & money-out, recycle bin, messaging, print layouts (2026-10-25)
- **One sign-in:** a single login box on `/` (email, username or login ID + password). The server works out who it is (`POST /api/auth/resolve-login`): owner → account page; staff → straight to their shop's role page (`src/lib/auth/landing.ts`: cashier → POS, waiter → orders, chef → kitchen, stock → items, accounts → accounting …). A username needs the Business ID; a password that matches staff in several shops shows a "choose shop" list.
- **Brand:** skyERPOS wordmark on the account header, locked / error / 404 pages, setup wizard; app home and POS show the brand icon and the Business ID.
- **POS keyboard:** visible key hints everywhere, `?` / Ctrl+/ help, Alt+C/R/B/N/O/X/M/D, `*` jumps to the cart, typed numbers set the quantity, no +/- on product tiles; variant picker is tab buttons (type "xl", Tab, "w", Enter). Products with sizes/colours show their variants' total stock and open the picker when found by SKU or barcode (was "out of stock"). Search icons no longer overlap the text (global compact-input rule moved to the base layer). Chat bubble moved off the pay keys on the POS. Checked at 1024, 1920 and 2560 wide.
- **Customer display:** second-screen window (Alt+D), mirrors the cart live; feature switch `customer_display` (super admin / owner).
- **Cheques & money-out (0171):** customer and supplier cheques (register, deposit, clear, bounce), cheque tender in the web POS, expenses / petty cash / reimbursements with categories and a counter expense limit, daily cheque reminders (`/api/cron/cheque-reminders`), mobile Money screen.
- **Owner dashboard:** gross profit and margin, stock value at cost / selling price, top items by profit, cheques due, expiring batches, low stock. The Low Stock tile now counts only items with a reorder level (matches the list).
- **Recycle bin (0172):** vendor deletes archive master data; posted documents are cancelled (full reversal), never removed. Super admin restores or permanently deletes per vendor (web and Admin app).
- **Print:** barcode stickers 1/2/3 across with exact sizes, gaps, preview, printer calibration and lock; receipt layout (separators, item layout, font, logo size/position, QR or barcode, "Powered by skyERPOS") with live preview; adjustable text size for vendors and the super admin (web and app).
- **SMS / WhatsApp (0174):** providers (Notify.lk, Text.lk, websms.lk, Twilio, generic HTTP, Meta WhatsApp Cloud API) configured by the super admin and switched on per vendor; e-receipt links (`/api/public/bill/<token>`). Secrets encrypted with `SECRETS_ENCRYPTION_KEY` (falls back to `NEXTAUTH_SECRET`).
- **Mobile stock intake (0175):** scanning an item that already exists says so; the sync first runs a dry run, lists conflicts, and asks "update price / keep price" for each changed price before posting; existing stock is never overwritten.
- **Server:** clients that hang up mid-request no longer crash the server; header / request / keep-alive timeouts.
- **Shared vehicle catalogue:** vendors can add makes/models but not edit or delete the shared list (403 `SHARED_CATALOG`).

Verification: fresh DB 0000–0175, 52 suites / 2,194 checks pass (new k1 cheques 115, k2 recycle bin 48, k3 messaging 88, pos-keyboard 90, print layout + receipt format 156, w3 intake 68); web + mobile typecheck clean; browser: one sign-in for owner / cashier (username + Business ID and email), POS keyboard flow at 1024 / 1920 / 2560, customer display, owner dashboard, cheques, expenses, receipt and label settings, messaging page.

## Round 14 — whole-app check, branch separation, admin-only businesses (2026-10-25)
- **Whole-app crawl** (production build): every vendor page (204) as the owner of each business type (6), as every staff role of a supermarket plus chef / waiter / cashier (restaurant), technician (auto service) and dealer sales, and every super-admin page — 0 crashes, 0 server errors after the fixes below. Each role lands on its own screen.
- **Fixed by the crawl:** Settings → Import/Export crashed (activity list read the wrong field); opening a deep link sent owners to the dashboard after the company sign-in (now returns to the page asked for, `?next=`); switched-off pages called their API before showing the "turned off" notice; restaurant Selling workspace asked for a missing "Recent orders" list; stock-takes and dealership inventory fetched during server render (unhandled server errors).
- **Branch separation (k4):** a staff member assigned to branches (Settings → Staff, or the super admin's Add staff) works only with those branches: branch lists, POS counters and shifts, sales and returns, stock, barcode lookups, adjustments, stock takes, intake, transfers (send from own branch, receive only at the destination), purchases / GRN, expenses, cheques, dashboards and branch reports. Owner and unassigned staff see everything (single-branch shops unchanged). Refusals are 403 `BRANCH_ACCESS_DENIED` with the branch named. Company-wide reports (GL, tax …) are refused to branch-restricted staff. Rule and helpers: `src/lib/auth/branch-access.ts`.
- **Businesses only via the super admin:** self sign-up removed (page and API; old `/register` links go to sign-in; login and landing pages say "Contact skyERPOS"); owners can no longer create a company from their account. Super admin → New vendor with an existing owner's email adds the business to that owner (same sign-in and password, listed next to their other businesses).
- **Stock in, end to end (browser):** items + opening stock from xlsx and CSV through the Items → Import wizard; a second file adds stock ("Insert or update" + "Add the file quantity"); web Stock Intake (scan existing → receive; unknown barcode → new item); new items and stock show on an open POS without reload and sell by barcode scan. Web intake now asks "update prices / keep current prices" when a line's selling price differs (as the app does).
- **Other gaps closed:** cheque tender in the app POS (number, bank, branch, date; when the counter lists cheques); expense bills can be attached (photo/PDF, private file, `/api/expenses/attachment`); a deleted vehicle document keeps its scan until purged from the recycle bin; staff of a shop whose setup is unfinished see "ask the owner" instead of the wizard; Low Stock tile counts only items with a reorder level; search icons no longer overlap input text (global input style moved to the base layer); chat bubble moved off the POS pay keys; products with variants open the picker when found by SKU / barcode.

Verification: fresh DB 0000–0175, 53 suites / 2,260 checks pass (new k4 branches 65); web + mobile typecheck clean; browser: imports 14/14 (xlsx and CSV), web intake 4/4, branch separation 10/10, admin-only businesses 8/8, POS keyboard, customer display, owner pages.
