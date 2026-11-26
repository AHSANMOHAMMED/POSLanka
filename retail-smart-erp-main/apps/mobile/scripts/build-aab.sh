#!/usr/bin/env bash
# Build a signed Google Play Store Android App Bundle (.aab) locally.
#
#   npm run build:aab                                   # skyERPOS (shop staff POS app)
#   APP_VARIANT=admin npm run build:aab                 # skyERPOS Admin (platform super admins)
#
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

API_URL="${API_URL:-https://www.skyerpos.com}"
APP_VARIANT="${APP_VARIANT:-vendor}"
export APP_VARIANT EXPO_PUBLIC_API_URL="$API_URL"
KEY_DIR="${POSLANKA_KEY_DIR:-$HOME/.poslanka-keys}"
KEYSTORE="$KEY_DIR/poslanka-release.jks"
PASSFILE="$KEY_DIR/poslanka-release.password"
ALIAS="poslanka"
ABIS="${ABIS:-arm64-v8a,armeabi-v7a}"

if [ ! -f "$KEYSTORE" ] || [ ! -f "$PASSFILE" ]; then
  echo "Signing keystore not found in $KEY_DIR. Run build-apk.sh first or configure $KEYSTORE."
  exit 1
fi
PASS="$(cat "$PASSFILE")"

echo "› Generating the native Android project for the $APP_VARIANT Play Store AAB (server $API_URL)"
CI=1 EXPO_PUBLIC_API_URL="$API_URL" npx expo prebuild --platform android --clean --no-install

KOTLIN_VERSION="$(sed -n 's/^kotlin = "\(.*\)"/\1/p' node_modules/react-native/gradle/libs.versions.toml | head -1)"
KOTLIN_VERSION="${KOTLIN_VERSION:-1.9.25}"

echo "› Building signed Play Store AAB for $ABIS (Kotlin $KOTLIN_VERSION)"
cd android
EXPO_PUBLIC_API_URL="$API_URL" NODE_ENV=production ./gradlew generateCodegenArtifactsFromSchema bundleRelease \
  -PreactNativeArchitectures="$ABIS" \
  -Pandroid.kotlinVersion="$KOTLIN_VERSION" \
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
if [ "$APP_VARIANT" = "admin" ]; then OUT="dist/skyERPOS-Admin-${VERSION}.aab"; else OUT="dist/skyERPOS-${VERSION}.aab"; fi
cp android/app/build/outputs/bundle/release/app-release.aab "$OUT"
REL_OUT="releases/$(basename "$OUT")"
cp "$OUT" "$REL_OUT"
(cd releases && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256")
echo "✔ $OUT ($(du -h "$OUT" | cut -f1))"
echo "✔ $REL_OUT"
