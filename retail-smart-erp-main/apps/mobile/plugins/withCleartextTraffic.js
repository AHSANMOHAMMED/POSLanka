/**
 * Expo config plugin: allow plain-HTTP connections from release builds.
 *
 * The server address is configurable on the sign-in screen and shops may run POSLanka on their
 * own network (http://192.168.x.x:3000). Android 9+ blocks cleartext HTTP in release builds by
 * default, so such a server was unreachable ("Cannot reach the POSLanka server") while debug
 * builds worked.
 *
 * Live-safe policy: keep cleartext enabled at the OS layer for LAN shop servers, and enforce
 * HTTPS for public/internet hosts in apps/mobile/app/login.tsx (release builds). Do not set
 * usesCleartextTraffic=false here — Android domain-config cannot reliably whitelist RFC1918
 * IP literals, and that would break on-site deployments after an APK rebuild.
 */
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]
    if (app) app.$['android:usesCleartextTraffic'] = 'true'
    return cfg
  })
}
