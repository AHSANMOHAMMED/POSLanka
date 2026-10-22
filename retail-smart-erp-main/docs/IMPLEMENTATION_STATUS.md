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
