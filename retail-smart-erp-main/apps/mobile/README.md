# POSLanka Mobile (Expo SDK 52)

Android-first React Native POS client that talks to the same Next.js APIs as the web app.

## Setup

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=https://your-server.example npx expo start   # or type the server URL on the login screen
npm run typecheck
```

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
