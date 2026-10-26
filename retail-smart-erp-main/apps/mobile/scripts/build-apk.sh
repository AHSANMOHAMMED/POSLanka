#!/usr/bin/env bash
# Build a standalone, release-signed Android APK locally (no Expo account needed).
#
#   npm run build:apk                                   # skyERPOS (shop staff POS app)
#   APP_VARIANT=admin npm run build:apk                 # skyERPOS Admin (platform super admins)
#   API_URL=http://192.168.1.10:3000 npm run build:apk  # default server for a local test build
#
# The server address is only the default: it can be changed on the app's sign-in screen.
# Needs JDK 17 and the Android SDK (ANDROID_HOME). Gradle downloads missing SDK/NDK parts.
# Tuned for a 14 GB laptop: one Gradle JVM (3 GB, Kotlin in-process), 2 workers, release lint
# skipped (analysis only, does not change the APK). Raise GRADLE_WORKERS on bigger machines.
# The signing key is created once in $POSLANKA_KEY_DIR (default ~/.poslanka-keys) — back it up:
# APKs signed with another key cannot be installed as updates over this one.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${JAVA_HOME:-}" ]; then
  if [ -d "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home" ]; then
    export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home"
  elif command -v /usr/libexec/java_home >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home 2>/dev/null || true)"
  fi
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}${ANDROID_HOME:+$ANDROID_HOME/platform-tools:}$PATH"

API_URL="${API_URL:-https://168-144-216-104.sslip.io}"
# vendor = skyERPOS (lk.poslanka.app), admin = skyERPOS Admin (lk.poslanka.admin) — see app.config.js
APP_VARIANT="${APP_VARIANT:-vendor}"
export APP_VARIANT EXPO_PUBLIC_APP_VARIANT="$APP_VARIANT"
KEY_DIR="${POSLANKA_KEY_DIR:-$HOME/.poslanka-keys}"
KEYSTORE="$KEY_DIR/poslanka-release.jks"
PASSFILE="$KEY_DIR/poslanka-release.password"
ALIAS="poslanka"
ABIS="${ABIS:-arm64-v8a,armeabi-v7a}"

if [ ! -f "$KEYSTORE" ]; then
  echo "› Creating release signing key in $KEYSTORE (one time)"
  mkdir -p "$KEY_DIR" && chmod 700 "$KEY_DIR"
  PASS="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  umask 077
  printf '%s' "$PASS" > "$PASSFILE"
  keytool -genkeypair -v -storetype PKCS12 -keystore "$KEYSTORE" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=POSLanka, OU=Mobile, O=POSLanka, L=Colombo, C=LK" >/dev/null
fi
PASS="$(cat "$PASSFILE")"

echo "› Generating the native Android project for the $APP_VARIANT app (default server $API_URL)"
CI=1 EXPO_PUBLIC_API_URL="$API_URL" npx expo prebuild --platform android --clean --no-install

echo "› Building release APK for $ABIS"
cd android
# New architecture: every library's codegen must exist before the app's C++ (CMake) build; the
# app build doesn't always wait for it, so generate it first (runs in every module that has it).
EXPO_PUBLIC_API_URL="$API_URL" NODE_ENV=production ./gradlew generateCodegenArtifactsFromSchema assembleRelease \
  -PreactNativeArchitectures="$ABIS" \
  -Pandroid.kotlinVersion=1.9.24 \
  -PPOSLANKA_STORE_FILE="$KEYSTORE" \
  -PPOSLANKA_STORE_PASSWORD="$PASS" \
  -PPOSLANKA_KEY_ALIAS="$ALIAS" \
  -PPOSLANKA_KEY_PASSWORD="$PASS" \
  -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=768m" \
  -Pkotlin.compiler.execution.strategy=in-process \
  --max-workers="${GRADLE_WORKERS:-2}" \
  -x lintVitalRelease \
  -Dorg.gradle.internal.http.socketTimeout=180000 \
  -Dorg.gradle.internal.http.connectionTimeout=180000 \
  -Dorg.gradle.internal.repository.max.retries=8 \
  --no-daemon
cd ..

VERSION="$(node -p "require('./app.json').expo.version")"
mkdir -p dist releases
if [ "$APP_VARIANT" = "admin" ]; then OUT="dist/skyERPOS-Admin-${VERSION}.apk"; else OUT="dist/skyERPOS-${VERSION}.apk"; fi
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
REL_OUT="releases/$(basename "$OUT")"
cp "$OUT" "$REL_OUT"
(cd releases && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256")
echo "✔ $OUT ($(du -h "$OUT" | cut -f1))"
echo "✔ $REL_OUT"
