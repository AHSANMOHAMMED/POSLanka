# POSLanka Mobile (Expo)

Android-first React Native POS client sharing the Next.js APIs.

## Setup

```bash
cd apps/mobile
npm install
npx expo start
```

## Features (v1)

- Login via `/api/auth/mobile-login`
- POS item search + cash checkout via `/api/sales`
- Shifts placeholder (same opening-entry APIs as web)
- Secure token storage
- Camera barcode & Bluetooth ESC/POS printers: add in follow-up EAS builds

## EAS

```bash
npx eas build --platform android --profile preview
```
