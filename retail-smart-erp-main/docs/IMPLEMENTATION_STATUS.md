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

## Still open
- Not exercised on physical hardware: a real Android phone, Bluetooth/USB/network thermal printers, cash drawers, USB/Bluetooth scanners, weighing scales. These need an EAS build (`apps/mobile/README.md`) and an on-site test.
- Push needs `npx eas init` (EAS project id) before notifications are delivered.
- Web WebUSB on Windows may need the WinUSB driver (Zadig); otherwise use the Print Agent in `tools/print-agent`.
