/**
 * Expo config plugin: allow plain-HTTP connections from release builds.
 *
 * The server address is configurable on the sign-in screen and shops may run POSLanka on their
 * own network (http://192.168.x.x:3000). Android 9+ blocks cleartext HTTP in release builds by
 * default, so such a server was unreachable ("Cannot reach the POSLanka server") while debug
 * builds worked. Production servers should still use https:// — this only stops Android from
 * refusing the LAN case.
 */
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]
    if (app) app.$['android:usesCleartextTraffic'] = 'true'
    return cfg
  })
}
