# POSLanka Mobile (Expo SDK 52)

Android-first React Native POS client that talks to the same Next.js APIs as the web app.

## Setup

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=https://168-144-216-104.sslip.io npx expo start   # or type the server URL on the login screen
npm run typecheck
```

**Production host (this deploy):** `https://168-144-216-104.sslip.io`  
Defaults, EAS preview/production, and “Open on web” use this origin. Saved `localhost` URLs are auto-migrated away so Live/More never open the phone’s loopback.

The server URL and company slug entered on the login screen are remembered on the device.

## What the app does

| Screen | Backend |
|---|---|
| Login | `POST /api/auth/mobile-login` (rate limited), then routes to POS if a shift is open, otherwise to Shifts |
| Shifts | `GET /api/pos-opening-entries?current=true`, `GET /api/pos-profiles`, `POST /api/pos-opening-entries`, `POST /api/pos-opening-entries/[id]/close` with per-method reconciliation (expected / counted / variance) |
| POS | server-side item search (`/api/items` scoped to the shift's branch), categories, camera + hardware barcode scan via `/api/items/barcode-lookup`, held sales, customer pick/create, tax templates, split tender, loyalty redemption, `POST /api/sales` with a per-cart `clientSaleId` (safe retries) |
| Approvals | purchase requisitions and employee advances pending approval (role-gated) |
| Stock | stock movement ledger for the shift's branch with scan-to-search (role-gated) |
| Summary | today's shifts, own-shift totals, dashboard stats for roles with `viewReports` |

Offline: cash and card sales made while offline are queued in a JSON file (`expo-file-system`) and replayed in order when connectivity returns (`@react-native-community/netinfo`). Credit, gift-card and loyalty sales are refused offline. A pending-count badge and "Sync now" live in the POS header.

Any 401 clears the stored session and returns to Login once.

## Receipt printers, scanners and push

| Feature | How |
|---|---|
| Bluetooth / USB / network (TCP 9100) ESC/POS printers | Printer screen (POS header → Printer). Pair, choose 58/80 mm, test print, drawer kick, auto-print. Driver: `react-native-thermal-receipt-printer-image-qr` |
| No raw printer | "System print" uses `expo-print` (Android print service / PDF share) |
| Receipts | printed after every sale and return; Z-report on shift close |
| Scanning | camera (EAN-13/8, UPC-A/E, Code 128/39/93, ITF-14, QR, DataMatrix, PDF417), torch, haptic; hardware wedge scanners type into the search box. Weighing-scale and GS1 labels set quantity, batch and expiry from the server |
| Push | registered after login (`POST /api/account/devices`); approvals, shift variance and low-stock alerts open the right screen |
| Super admin | "Super admin" on the login screen → Pulse, Live sales, Vendors (lock/unlock, features), Payment approvals; TOTP code supported |

## Building the app

The printer driver is a **native module**, so it does not run in Expo Go. Build a development or release APK with EAS:

```bash
npm install            # .npmrc sets legacy-peer-deps for the driver's react-native-ping peer
npx eas login
npx eas init           # writes extra.eas.projectId into app.json (also needed for push)
npx eas build --platform android --profile development   # dev client APK, then: npx expo start --dev-client
npx eas build --platform android --profile preview       # installable test APK
npx eas build --platform android --profile production    # Play Store bundle
```

Set the server URL per profile in `eas.json` (`EXPO_PUBLIC_API_URL`). In Expo Go everything except Bluetooth/USB/network printing works, and the Printer screen says so.

### Local release APK (no Expo account)

```bash
npm run build:apk                                   # → dist/skyERPOS-<version>.apk, server https://168-144-216-104.sslip.io
API_URL=http://192.168.1.10:3000 npm run build:apk  # different default server (still editable on the sign-in screen)
ABIS=x86_64 npm run build:apk                       # emulator test build (real phones are arm64/armv7)
```

Needs JDK 17 and the Android SDK (`ANDROID_HOME`); Gradle fetches missing SDK/NDK parts. The script
regenerates `android/` with `expo prebuild`, runs the libraries' codegen first (new architecture), and
signs with the POSLanka key in `~/.poslanka-keys/` (created on first run). **Back that folder up** —
an APK signed with a different key cannot be installed as an update over this one.

The latest published build is in `releases/` (with its SHA-256). Install it with
`adb install releases/POSLanka-1.0.0.apk` or by copying it to the phone. `http://` servers on a shop's
own network are allowed (cleartext), but use `https://` for anything reachable from the internet.
Release builds **block** public `http://` API bases on the sign-in screen (private LAN `192.168/10/172.16–31` still OK).

## Appearance & language

- **Light theme only** (no dark mode).
- **EN / සිංහල / தமிழ்** on the login screen and under More → language. Locale is stored as `poslanka_locale` and used for system login notices and inbox alert text. Full POS chrome translation is not shipped yet (same as web).

## Staff & platform notifications

| Flow | Where |
|---|---|
| Login notices (SA announcement + broadcasts with “show on login”) | Shop login screen before sign-in |
| Staff → staff push + inbox | More → **Notify staff** (or Alerts → megaphone). Cashiers: selected colleagues only. Managers: also Managers / Everyone (rate limited). |
| Alerts inbox + push prefs | More → Alerts |
| Admin broadcasts (EN + optional SI/TA, show on login) | Admin app → Notifications |

Push tokens register after shop login (`POST /api/account/devices`). Tokens cannot be stolen by another account (409). 401 / logout unregisters the device.

## Smoke checklist

1. Cashier: Notify staff → pick a manager → manager phone gets push + Alerts inbox row.
2. Manager: Notify staff → Everyone (at most once/day) reaches active staff phones.
3. Login notices: set SI/TA announcement in sys-control → open shop login → switch language → notice text changes.
4. Register push on device A, then try registering the same Expo token as another user → **409**.
5. Force 401 (invalidate session) → app returns to login and the device row is removed (no further push).
